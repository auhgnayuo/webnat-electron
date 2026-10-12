export class JavaScriptAliveKeeper {
  private timerInterval: number;
  private heartbeat: () => void;
  private _heartbeatInterval: number = 1000;
  private referenceCount: number = 0;
  private nextHeartbeatTime: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(timerInterval: number, heartbeat: () => void) {
    this.timerInterval = timerInterval;
    this.heartbeat = heartbeat;
  }

  get heartbeatInterval(): number {
    return this._heartbeatInterval;
  }

  set heartbeatInterval(value: number) {
    if (value <= 0) {
      console.warn(`Invalid heartbeatInterval, using previous value: ${this._heartbeatInterval}`);
      return;
    }
    const oldValue = this._heartbeatInterval;
    this._heartbeatInterval = value;
    if (this.nextHeartbeatTime !== undefined) {
      this.nextHeartbeatTime = this.nextHeartbeatTime + (value - oldValue);
    }
  }

  increaseReference(): void {
    this.referenceCount += 1;
    if (this.referenceCount === 1) {
      this.startTimer();
    }
  }

  decreaseReference(): void {
    this.referenceCount = Math.max(this.referenceCount - 1, 0);
    if (this.referenceCount === 0) {
      this.stopTimer();
    }
  }

  delay(): void {
    this.nextHeartbeatTime = Date.now() + this.heartbeatInterval;
  }

  private startTimer(): void {
    this.stopTimer();
    this.nextHeartbeatTime = Date.now() + this.heartbeatInterval;
    this.timer = setInterval(() => {
      if (this.nextHeartbeatTime === undefined) {
        return;
      }
      const now = Date.now();
      if (now >= this.nextHeartbeatTime) {
        this.heartbeat();
        this.nextHeartbeatTime = now + this.heartbeatInterval;
      }
    }, this.timerInterval);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
