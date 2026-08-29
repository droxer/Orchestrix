export interface ActivityChartPoint {
  date: string;
  count: number;
  completed: number;
  failed: number;
}

/** Keep the chart's minimum visual range separate from the value reported to
 * users. A scale floor is presentation state, not observed activity. */
export function activityChartMetrics(points: readonly ActivityChartPoint[]) {
  const dataPeak = Math.max(0, ...points.map((point) => point.count));
  return {
    dataPeak,
    scaleMax: Math.max(dataPeak, 4),
  };
}
