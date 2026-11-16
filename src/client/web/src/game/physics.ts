// Rider physics — pure simulation model (no rendering, no DOM).
// Power -> force balance (gravity, rolling, aero drag) -> speed, with gears,
// cadence and a heart-rate model. Same constants as classic cycling math.
// Same constants and formulas so speeds feel identical on both clients.

export interface RiderInput {
  pedal: boolean;
  sprint: boolean;
  brake: boolean;
}

const FRONT_TEETH = [50, 34];
const REAR_TEETH = [11, 12, 13, 14, 15, 17, 19, 21, 24, 28, 32];

const RIDER_MASS = 72;
const BIKE_MASS = 8;
const CRR = 0.004;
const CD_A = 0.30;
const AIR_DENSITY = 1.225;
const G = 9.81;
const DRIVETRAIN = 0.97;
const WHEEL_RADIUS = 0.335;

export class RiderPhysics {
  speed = 0; // m/s
  power = 0;
  cadence = 0;
  heartRate = 88;
  gradient = 0;
  gearFront = 1;
  gearRear = 5;
  autoShift = true;
  ftp = 220;

  private pedalInput = 0;
  private brakeInput = 0;

  setGradient(g: number): void {
    this.gradient = Math.min(0.35, Math.max(-0.3, g));
  }

  update(dt: number, input: RiderInput): void {
    this.pedalInput = input.pedal ? 0.85 : 0;
    this.brakeInput = input.brake ? 1 : 0;

    // --- power source (simulated rider; trainer/ERG hook omitted on web) ---
    if (this.pedalInput > 0.01) {
      const cadenceFactor = Math.min(1, Math.max(0.35, 1 - Math.abs(this.cadence - 88) / 120));
      const sprintBonus = input.sprint ? 1.25 : 1;
      this.power = (140 + 620 * Math.pow(this.pedalInput, 1.2)) * cadenceFactor * sprintBonus;
    } else {
      this.power = 0;
    }

    // --- force balance ---
    const totalMass = RIDER_MASS + BIKE_MASS;
    const effectivePower = this.power * DRIVETRAIN;
    const fGravity = totalMass * G * Math.sin(this.gradient);
    const fRolling = totalMass * G * Math.cos(this.gradient) * CRR;
    const fDrag = 0.5 * AIR_DENSITY * CD_A * this.speed * this.speed;
    const fBrake = this.brakeInput * totalMass * G * 0.45;

    let fNet: number;
    if (this.speed > 0.2 || effectivePower > 15) {
      fNet = effectivePower / Math.max(this.speed, 0.6) - fGravity - fRolling - fDrag - fBrake;
    } else {
      fNet = -fGravity - fRolling - fBrake;
      if (fNet > 0 && effectivePower < 5) fNet = 0; // no creeping without pedaling
    }

    this.speed = Math.max(0, this.speed + (fNet / totalMass) * dt);
    if (this.brakeInput > 0.5) {
      this.speed = Math.max(0, this.speed - 6 * dt); // move_toward(0)
    }

    // --- cadence from speed + gear ---
    const ratio = this.gearRatio();
    if (this.speed > 0.3 && this.pedalInput > 0.01) {
      const wheelRpm = (this.speed / (2 * Math.PI * WHEEL_RADIUS)) * 60;
      this.cadence = Math.min(130, Math.max(0, Math.floor(wheelRpm / ratio)));
    } else if (this.speed <= 0.3) {
      this.cadence = 0;
    }

    // --- heart rate simulation ---
    const zone = this.ftp > 0 ? Math.min(2, Math.max(0, this.power / this.ftp)) : 0;
    let target = 92 + zone * 34 + Math.max(this.gradient, 0) * 220;
    if (this.speed < 0.5 && this.power < 5) target = 78;
    const rate = target > this.heartRate ? 3.2 : 1.6;
    // keep HR as a float internally — rounding every frame would freeze it
    const hr = this.heartRate + Math.sign(target - this.heartRate) * Math.min(Math.abs(target - this.heartRate), rate * dt);
    this.heartRate = Math.min(190, Math.max(55, hr));

    this.autoShiftGears();
  }

  private gearRatio(): number {
    const f = FRONT_TEETH[Math.min(Math.max(this.gearFront - 1, 0), FRONT_TEETH.length - 1)];
    const r = REAR_TEETH[Math.min(Math.max(this.gearRear - 1, 0), REAR_TEETH.length - 1)];
    return f / r;
  }

  private autoShiftGears(): void {
    if (!this.autoShift) return;
    if (this.cadence < 62 && this.speed > 1) this.shiftUp();
    else if (this.cadence > 102) this.shiftDown();
  }

  shiftUp(): void {
    if (this.gearRear < REAR_TEETH.length) this.gearRear++;
    else if (this.gearFront < FRONT_TEETH.length) { this.gearFront++; }
  }

  shiftDown(): void {
    if (this.gearRear > 1) this.gearRear--;
    else if (this.gearFront > 1) { this.gearFront--; this.gearRear = REAR_TEETH.length; }
  }
}
