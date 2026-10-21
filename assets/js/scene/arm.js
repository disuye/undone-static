import { Group } from '../vendor/three.module.js';
import { createSequencer } from './motion.js';
import { at, block, createPiston, hose, plate, prism } from './parts.js';

const joint = (parent, y, ...children) => {
  const group = new Group();
  group.position.y = y;
  group.add(...children);
  parent.add(group);
  return group;
};

const anchor = (parent, x, y, z) => {
  const g = new Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};

// Side profiles (x forward, y up). Deliberately lopsided: armour is heavier on the back edge.
const PROFILE = {
  turret: [[-0.36, 0], [0.3, 0], [0.4, 0.16], [0.22, 0.5], [-0.12, 0.6], [-0.4, 0.34]],
  upper: [[-0.21, 0.06], [0.15, 0], [0.23, 0.5], [0.15, 1.36], [-0.06, 1.5], [-0.22, 1.12], [-0.27, 0.48]],
  upperSide: [[-0.1, 0.22], [0.12, 0.34], [0.09, 0.98], [-0.05, 1.18], [-0.15, 0.7]],
  fore: [[-0.14, -0.04], [0.11, 0], [0.18, 0.36], [0.11, 1.1], [-0.05, 1.22], [-0.16, 0.66]],
  foreFin: [[-0.02, 0.1], [0.06, 0.16], [0.03, 0.62], [-0.04, 0.5]],
  wrist: [[-0.1, 0], [0.1, 0], [0.13, 0.17], [0.01, 0.29], [-0.11, 0.2]],
  fingerLong: [[0, 0], [0.045, 0], [0.065, 0.22], [0.025, 0.31], [0, 0.2]],
  fingerShort: [[0, 0], [-0.045, 0], [-0.055, 0.15], [-0.012, 0.2]],
  junction: [[0, 0], [0.34, 0], [0.3, 0.22], [0.05, 0.26]],
};

/**
 * Six-axis prototype arm, built pointing up local +y, reaching toward local +x.
 * Pose = [yaw, shoulder, elbow, wrist, roll] in radians; negative pitch leans forward.
 * Asymmetry lives on ±z: ram and hose on one side, extra armour and actuator on the other.
 */
export const createArm = (m, poses, timing) => {
  const root = new Group();
  root.add(
    at(prism(0.56, 0.16, 8, m.armourGrey), 0, 0.08),
    at(prism(0.42, 0.05, 8, m.mech), 0, 0.185),
    at(plate(PROFILE.junction, 0.22, m.armourGrey), -0.2, 0.02, -0.55, 0, 0.3),
  );

  const yaw = joint(root, 0.2,
    at(plate(PROFILE.turret, 0.56, m.armour), 0, 0, 0.02),
    at(prism(0.22, 0.56, 8, m.armourGrey, 'z'), 0, 0.55, 0.06),
    at(prism(0.13, 0.24, 6, m.mech, 'z'), -0.05, 0.55, 0.42),
    at(block(0.14, 0.1, 0.06, m.mech), -0.3, 0.3, -0.3));
  const ramBase = anchor(yaw, -0.3, 0.3, -0.33);

  const shoulder = joint(yaw, 0.55,
    at(block(0.15, 1.42, 0.18, m.mech), -0.02, 0.75, 0),
    at(plate(PROFILE.upper, 0.27, m.armour), 0, 0, 0.05),
    at(plate(PROFILE.upperSide, 0.035, m.armourGrey), 0, 0, 0.24, 0, 0.08),
    at(prism(0.17, 0.44, 8, m.armourGrey, 'z'), 0, 1.5, -0.03),
    hose([[-0.2, 0.12, -0.18], [-0.34, 0.62, -0.24], [-0.3, 1.1, -0.22], [-0.12, 1.48, -0.2]], 0.026, m.cables[0], true),
    hose([[-0.16, 0.1, -0.2], [-0.29, 0.7, -0.27], [-0.1, 1.46, -0.24]], 0.016, m.cables[4], true));
  const ramHead = anchor(shoulder, -0.2, 0.92, -0.33);

  const elbow = joint(shoulder, 1.5,
    at(plate(PROFILE.fore, 0.22, m.armour), 0, 0, -0.02),
    at(plate(PROFILE.foreFin, 0.03, m.armourGrey), 0.1, 0.3, -0.15, 0, -0.12),
    at(prism(0.035, 0.78, 6, m.steel), 0.05, 0.6, 0.16),
    at(prism(0.06, 0.12, 6, m.mech), 0.05, 0.18, 0.16),
    at(prism(0.11, 0.3, 6, m.armourGrey, 'z'), 0, 1.2, 0.02),
    hose([[0.13, 0.08, 0.13], [0.22, 0.6, 0.2], [0.09, 1.16, 0.14]], 0.02, m.cables[1], true));

  const wrist = joint(elbow, 1.2,
    at(plate(PROFILE.wrist, 0.19, m.armour), 0, 0, 0.01));

  const roll = joint(wrist, 0.28,
    at(prism(0.09, 0.06, 8, m.steel), 0, 0.03),
    at(plate(PROFILE.fingerLong, 0.05, m.armourGrey), 0.03, 0.05, 0),
    at(plate(PROFILE.fingerShort, 0.05, m.armourGrey), -0.03, 0.05, 0),
    at(prism(0.045, 0.12, 6, m.mech, 'z'), 0, 0.07, 0.1),
    at(prism(0.03, 0.02, 12, m.glow, 'z'), 0, 0.07, 0.165),
    at(prism(0.03, 0.02, 12, m.glow), 0, 0.12, -0.03));

  const ram = createPiston(root, ramBase, ramHead, m.armourGrey, m.steel);
  const sequence = createSequencer(poses, timing);
  const pose = new Array(5).fill(0);

  const update = (time) => {
    sequence(time, pose);
    yaw.rotation.y = pose[0];
    shoulder.rotation.z = pose[1];
    elbow.rotation.z = pose[2];
    wrist.rotation.z = pose[3];
    roll.rotation.y = pose[4];
    root.updateMatrixWorld(true);
    ram();
  };

  return { object: root, update };
};

// Yaw that turns local +x toward a world-space offset (dx, dz).
export const aimYaw = (dx, dz) => Math.atan2(-dz, dx);
