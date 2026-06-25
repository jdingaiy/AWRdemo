/* =====================================================================
   RobotView —— three.js 渲染 URDF 机器人 + 关节联动（Web 预览）
   四种控制模式的关节映射（速度积分式，松手停在当前位置）：
     底盘 chassis：Move → 三轮平移；Rotate → 整机 heading 旋转
     躯干 torso ：头部俯仰(无关节,仅HUD) / 腰俯仰 waist_pitch / 升降腰 waist_lift / 腰旋转(heading)
     手臂 arm   ：选中臂的 肩pitch/肩roll/肘/腕pitch/腕yaw/腕roll 近似笛卡尔联动
     夹爪 gripper：开合(无关节,仅HUD)
   每种模式有独立镜头预设，setFocus(mode) 平滑切换。
   ===================================================================== */
import * as THREE from 'three';
import URDFLoader from '../vendor/URDFLoader.js';

const ROBOT_ROOT = '../assets/robot/10000111A01/10000111A01';
const URDF_PATH = ROBOT_ROOT + '/urdf/10000111A01.urdf';

const LIFT = { min: 0.006, max: 0.286 };
const WAIST_PITCH = { min: -0.26, max: 1.6 };
const ARM_LIM = {
  shoulder_pitch: [-3, 3],
  shoulder_roll_l: [-0.78, 2.5],
  shoulder_roll_r: [-2.5, 0.78],
  elbow: [-2.2, 2.2],
  wrist_yaw: [-3, 3],
  wrist_pitch: [-1.9, 1.9],
  wrist_roll: [-1.6, 1.6],
};

export class RobotView {
  constructor(container) {
    this.container = container;
    this.robot = null;
    this.cmd = {
      lift: 0, yaw: 0, moveX: 0, moveY: 0, waistPitch: 0, waistYaw: 0,
      armX: 0, armY: 0, armZ: 0, armRx: 0, armRy: 0, armRz: 0,
    };
    this.armSide = 'left';
    this.state = {
      lift: LIFT.min, yaw: 0, wheel: 0, waistPitch: 0, waistYaw: 0,
      arm: { left: this._zeroArm(), right: this._zeroArm() },
    };
    this._lastT = null;
    this._dragYaw = 0;
    this._dragPitch = 0;
    this.focusMode = 'chassis';

    this._initScene();
    this._loadRobot();
    this._initDrag();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
    window.addEventListener('resize', () => this._resize());
  }

  _zeroArm() { return { sp: 0, sr: 0, el: 0, wy: 0, wp: 0, wr: 0 }; }

  _initDrag() {
    const el = this.renderer.domElement;
    const PITCH_MIN = -0.15, PITCH_MAX = 0.5;
    let active = false, lastX = 0, lastY = 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    el.addEventListener('pointerdown', (e) => {
      active = true; lastX = e.clientX; lastY = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const limit = this.focusMode === 'chassis' ? Math.PI / 4 : Math.PI;
      this._dragYaw = clamp(this._dragYaw - dx * 0.005, -limit, limit);
      this._dragPitch = clamp(this._dragPitch + dy * 0.004, PITCH_MIN, PITCH_MAX);
    });
    const end = (e) => { active = false; try { el.releasePointerCapture(e.pointerId); } catch {} };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _initScene() {
    const w = this.container.clientWidth || 340;
    const h = this.container.clientHeight || 480;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x14171c, 5, 20);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
    this.camera.position.set(0, 0.3, 3.5);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);
    const grid = new THREE.GridHelper(200, 400, 0x4a5160, 0x2a2f3a);
    grid.position.y = -0.005;
    grid.material.fog = true;
    this.scene.add(grid);
    this.grid = grid;
    const axisMat = (hex) => new THREE.LineBasicMaterial({ color: hex, fog: true });
    const L = 100;
    const xGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-L, 0, 0), new THREE.Vector3(L, 0, 0)]);
    this.scene.add(new THREE.Line(xGeo, axisMat(0x1f4fd6)));
    const yGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -L), new THREE.Vector3(0, 0, L)]);
    this.scene.add(new THREE.Line(yGeo, axisMat(0x33c04a)));
    this._target = new THREE.Vector3(0, 0.5, 0);
  }

  _loadRobot() {
    const loader = new URDFLoader();
    loader.packages = {
      '10000111A01': ROBOT_ROOT,
      '10000111-A-A11.SLDASM': ROBOT_ROOT,
    };
    loader.load(URDF_PATH, (robot) => {
      this.robot = robot;
      robot.rotation.x = -Math.PI / 2;
      robot.traverse((c) => {
        if (c.isMesh) {
          c.material = new THREE.MeshStandardMaterial({ color: 0xc9cace, roughness: 0.65, metalness: 0.15 });
          c.castShadow = c.receiveShadow = false;
        }
      });
      this.pivot = new THREE.Group();
      this.pivot.add(robot);
      robot.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.PI + Math.PI / 2);
      this.scene.add(this.pivot);
      this.setArmsDefault();
      this._needFrame = true;
    });
  }

  _frameRobot() {
    this.pivot.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let any = false;
    this.pivot.traverse((c) => {
      if (c.isMesh && c.geometry) {
        c.geometry.computeBoundingBox();
        const b = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld);
        box.union(b); any = true;
      }
    });
    if (!any) return;
    const size = box.getSize(new THREE.Vector3());
    const baseLink = this.robot.links && this.robot.links['base_link'];
    let cx = 0, cz = 0;
    if (baseLink) {
      baseLink.updateMatrixWorld(true);
      const o = new THREE.Vector3();
      o.setFromMatrixPosition(baseLink.matrixWorld);
      cx = o.x; cz = o.z;
    } else {
      const center = box.getCenter(new THREE.Vector3());
      cx = center.x; cz = center.z;
    }
    const minY = box.min.y;
    this.pivot.position.x -= cx;
    this.pivot.position.z -= cz;
    this.pivot.position.y -= minY;
    this._size = { x: size.x, y: size.y, z: size.z };
    const midY = size.y * 0.5;
    const fillDist = size.y / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this._fillDist = fillDist;
    this._cam = { dist: fillDist * 3.6, height: midY + size.y * 0.45, targetY: midY, latOff: 0 };
    this._camTarget = { ...this._cam };
    this._heading = 0;
    this.pivot.rotation.y = 0;
    this.setFocus(this.focusMode, true);
    this._updateFollowCam();
    this._home = { pos: this.pivot.position.clone(), heading: this._heading };
  }

  /* 镜头预设：每种模式聚焦不同部位（平滑过渡）。 */
  setFocus(mode, instant) {
    this.focusMode = mode;
    if (!this._size) return;
    const limit = mode === 'chassis' ? Math.PI / 4 : Math.PI;
    this._dragYaw = Math.max(-limit, Math.min(limit, this._dragYaw));

    const sy = this._size.y, fd = this._fillDist;
    let preset;
    switch (mode) {
      case 'chassis':
        preset = { dist: fd * 3.7, height: sy * 0.95, targetY: sy * 0.5, latOff: 0, yawOff: 0 }; break;
      case 'torso':
        preset = { dist: fd * 2.7, height: sy * 0.78, targetY: sy * 0.62, latOff: 0, yawOff: Math.PI / 2 }; break;
      case 'arm': {
        // 镜头转到所控手臂的侧面偏前视角（左/右臂分别朝对应一侧）
        const side = this.armSide === 'right' ? 1 : -1;
        preset = { dist: fd * 2.0, height: sy * 0.72, targetY: sy * 0.62, latOff: side * this._size.x * 0.14, yawOff: side * 1.95 }; break;
      }
      case 'gripper':
        // 正面聚焦到手臂末端（夹爪预计位置，较低）
        preset = { dist: fd * 1.3, height: sy * 0.55, targetY: sy * 0.42, latOff: 0, yawOff: Math.PI }; break;
      default:
        preset = { dist: fd * 3.6, height: sy * 0.9, targetY: sy * 0.5, latOff: 0, yawOff: 0 };
    }
    this._camTarget = preset;
    if (instant) this._cam = { ...preset };
  }

  _updateFollowCam(dt) {
    if (!this._cam || !this.pivot) return;
    if (this._camTarget) {
      const ck = dt ? 1 - Math.exp(-2.6 * dt) : 1;
      for (const k of ['dist', 'height', 'targetY', 'latOff', 'yawOff']) {
        const tgt = this._camTarget[k] || 0;
        this._cam[k] = (this._cam[k] || 0) + (tgt - (this._cam[k] || 0)) * ck;
      }
    }
    const h = this._heading + (this._dragYaw || 0) + (this._cam.yawOff || 0);
    const fX = Math.sin(h), fZ = Math.cos(h);
    const rX = Math.cos(h), rZ = -Math.sin(h);
    const px = this.pivot.position.x, pz = this.pivot.position.z;
    const lat = this._cam.latOff || 0;
    const tx = px + rX * lat, tz = pz + rZ * lat;
    const pitch = this._dragPitch || 0;
    const dist = this._cam.dist;
    const dx = tx - fX * dist;
    const dz = tz - fZ * dist;
    const dy = this._cam.height + pitch * dist;
    const k = dt ? 1 - Math.exp(-3.5 * dt) : 1;
    this.camera.position.x += (dx - this.camera.position.x) * k;
    this.camera.position.y += (dy - this.camera.position.y) * k;
    this.camera.position.z += (dz - this.camera.position.z) * k;
    this._target.set(tx, this._cam.targetY, tz);
    this.camera.lookAt(tx, this._cam.targetY, tz);
  }

  reset() {
    if (!this.robot) return;
    this.cmd = { lift: 0, yaw: 0, moveX: 0, moveY: 0, waistPitch: 0, waistYaw: 0, armX: 0, armY: 0, armZ: 0, armRx: 0, armRy: 0, armRz: 0 };
    this.state.lift = LIFT.min;
    this.state.waistPitch = 0;
    this.state.waistYaw = 0;
    this.state.arm = { left: this._zeroArm(), right: this._zeroArm() };
    this._heading = 0;
    this._dragYaw = 0; this._dragPitch = 0;
    const J = this.robot.joints;
    J['waist_lift_joint'] && J['waist_lift_joint'].setJointValue(LIFT.min);
    J['waist_pitch_joint'] && J['waist_pitch_joint'].setJointValue(0);
    J['waist_yaw_joint'] && J['waist_yaw_joint'].setJointValue(0);
    this.setArmsDefault();
    if (this._home) {
      this.pivot.position.copy(this._home.pos);
      this._heading = this._home.heading;
      this.pivot.rotation.y = this._heading;
    }
    this.setFocus(this.focusMode, true);
  }

  setArmsDefault() {
    if (!this.robot) return;
    const set = (n, v) => { const j = this.robot.joints[n]; if (j) j.setJointValue(v); };
    for (const s of ['left', 'right']) {
      set(s + '_shoulder_pitch_joint', 0);
      set(s + '_shoulder_roll_joint', 0);
      set(s + '_shoulder_yaw_joint', 0);
      set(s + '_elbow_joint', 0);
      set(s + '_wrist_yaw_joint', 0);
      set(s + '_wrist_pitch_joint', 0);
      set(s + '_wrist_roll_joint', 0);
    }
  }

  // —— 控制组件写入速度指令（-1..1）——
  setMoveCmd(x, y) { this.cmd.moveX = x; this.cmd.moveY = y; }
  setYawCmd(v) { this.cmd.yaw = v; }
  setWaistYawCmd(v) { this.cmd.waistYaw = v; }
  setLiftCmd(v) { this.cmd.lift = v; }
  setWaistPitchCmd(v) { this.cmd.waistPitch = v; }
  setArmSide(side) {
    if (side !== 'left' && side !== 'right') return;
    this.armSide = side;
    if (this.focusMode === 'arm') this.setFocus('arm');
  }
  setArmTransCmd(x, y, z) { this.cmd.armX = x; this.cmd.armY = y; this.cmd.armZ = z; }
  setArmRotCmd(rx, ry, rz) { this.cmd.armRx = rx; this.cmd.armRy = ry; this.cmd.armRz = rz; }

  _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 手臂近似笛卡尔：末端 X/Y/Z 平移 + Rx/Ry/Rz 姿态 → 关节速度。
  _integrateArm(dt) {
    const c = this.cmd;
    if (!(c.armX || c.armY || c.armZ || c.armRx || c.armRy || c.armRz)) return;
    const side = this.armSide;
    const a = this.state.arm[side];
    const sgn = side === 'left' ? 1 : -1;
    const sp = 1.1 * dt;
    a.sp = this._clamp(a.sp - c.armZ * sp - c.armY * sp * 0.4, ARM_LIM.shoulder_pitch[0], ARM_LIM.shoulder_pitch[1]);
    a.el = this._clamp(a.el + c.armY * sp + c.armZ * sp * 0.3, ARM_LIM.elbow[0], ARM_LIM.elbow[1]);
    const rl = side === 'left' ? ARM_LIM.shoulder_roll_l : ARM_LIM.shoulder_roll_r;
    a.sr = this._clamp(a.sr + c.armX * sp * sgn, rl[0], rl[1]);
    a.wr = this._clamp(a.wr + c.armRx * sp, ARM_LIM.wrist_roll[0], ARM_LIM.wrist_roll[1]);
    a.wp = this._clamp(a.wp + c.armRy * sp, ARM_LIM.wrist_pitch[0], ARM_LIM.wrist_pitch[1]);
    a.wy = this._clamp(a.wy + c.armRz * sp, ARM_LIM.wrist_yaw[0], ARM_LIM.wrist_yaw[1]);
    const J = this.robot.joints, p = side + '_';
    J[p + 'shoulder_pitch_joint'] && J[p + 'shoulder_pitch_joint'].setJointValue(a.sp);
    J[p + 'shoulder_roll_joint'] && J[p + 'shoulder_roll_joint'].setJointValue(a.sr);
    J[p + 'elbow_joint'] && J[p + 'elbow_joint'].setJointValue(a.el);
    J[p + 'wrist_roll_joint'] && J[p + 'wrist_roll_joint'].setJointValue(a.wr);
    J[p + 'wrist_pitch_joint'] && J[p + 'wrist_pitch_joint'].setJointValue(a.wp);
    J[p + 'wrist_yaw_joint'] && J[p + 'wrist_yaw_joint'].setJointValue(a.wy);
  }

  _tick(t) {
    requestAnimationFrame(this._tick);
    const dt = this._lastT != null ? Math.min((t - this._lastT) / 1000, 0.05) : 0;
    this._lastT = t;
    if (this._needFrame && this.pivot) {
      let meshCount = 0, geomCount = 0;
      this.pivot.traverse((c) => {
        if (c.isMesh) { meshCount++; if (c.geometry && c.geometry.attributes.position) geomCount++; }
      });
      if (meshCount >= 24 && geomCount === meshCount) { this._frameRobot(); this._needFrame = false; }
    }
    if (this.robot && dt > 0) {
      const J = this.robot.joints;
      if (this.cmd.lift !== 0) {
        this.state.lift = this._clamp(this.state.lift + this.cmd.lift * 0.12 * dt, LIFT.min, LIFT.max);
        J['waist_lift_joint'] && J['waist_lift_joint'].setJointValue(this.state.lift);
      }
      if (this.cmd.waistPitch !== 0) {
        this.state.waistPitch = this._clamp(this.state.waistPitch + this.cmd.waistPitch * 0.8 * dt, WAIST_PITCH.min, WAIST_PITCH.max);
        J['waist_pitch_joint'] && J['waist_pitch_joint'].setJointValue(this.state.waistPitch);
      }
      if (this.cmd.yaw !== 0) {
        this._heading -= this.cmd.yaw * 1.2 * dt;
        this.pivot.rotation.y = this._heading;
      }
      if (this.cmd.waistYaw !== 0) {
        this.state.waistYaw = this._clamp(this.state.waistYaw + this.cmd.waistYaw * 1.5 * dt, -3.07, 3.07);
        J['waist_yaw_joint'] && J['waist_yaw_joint'].setJointValue(this.state.waistYaw);
      }
      const fwd = this.cmd.moveY, side = this.cmd.moveX;
      const mag = Math.hypot(fwd, side);
      if (mag > 0.001 && this.pivot) {
        const h = this._heading;
        const fX = Math.sin(h), fZ = Math.cos(h);
        const rX = -Math.cos(h), rZ = Math.sin(h);
        const spd = 0.8;
        this.pivot.position.x += (fwd * fX + side * rX) * spd * dt;
        this.pivot.position.z += (fwd * fZ + side * rZ) * spd * dt;
        const wheel = mag * 6 * dt;
        J['left_front_wheel_joint'] && J['left_front_wheel_joint'].setJointValue((J['left_front_wheel_joint'].angle || 0) + wheel);
        J['right_front_wheel_joint'] && J['right_front_wheel_joint'].setJointValue((J['right_front_wheel_joint'].angle || 0) + wheel);
        J['rear_wheel_joint'] && J['rear_wheel_joint'].setJointValue((J['rear_wheel_joint'].angle || 0) + wheel);
      }
      this._integrateArm(dt);
    }
    if (this._cam) this._updateFollowCam(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
