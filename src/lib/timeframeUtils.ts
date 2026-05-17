
export function getTimeframes(isLongTerm: boolean) {
  if (isLongTerm) {
    return {
      m1: '15m',
      m5: '1h',
      m15: '4h'
    };
  }
  return {
    m1: '1m',
    m5: '5m',
    m15: '15m'
  };
}
