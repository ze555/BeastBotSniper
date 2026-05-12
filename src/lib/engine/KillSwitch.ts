
export class KillSwitch {
  private manualPanicActive = false;

  public setManualPanic(active: boolean) {
    this.manualPanicActive = active;
  }

  /**
   * الفحص الأمني السريع
   */
  public shouldPanic(marketMetrics: { spread: number; volatility: number }, systemStatus: { apiLag: number }): { panic: boolean; reason?: string } {
    // 0. Manual Trigger
    if (this.manualPanicActive) {
      return { panic: true, reason: 'MANUAL_EMERGENCY_STOP' };
    }

    // 1. Spread Explosion (Fake liquidity)
    if (marketMetrics.spread > 0.5) {
      return { panic: true, reason: 'SPREAD_EXPLOSION' };
    }

    // 2. Volatility Insanity (Market Crash or Spike)
    if (marketMetrics.volatility > 15) {
      return { panic: true, reason: 'ABNORMAL_VOLATILITY' };
    }

    // 3. API/Network Lag
    if (systemStatus.apiLag > 2000) {
      return { panic: true, reason: 'CRITICAL_NETWORK_LAG' };
    }

    return { panic: false };
  }
}
