/**
 * Calculates snapshot vs. backup cost and tells you which one is cheaper.
 *
 * @param serverMonthlyPriceNet - server's monthly price, net (VAT excluded)
 * @param snapshotPricePerGbNet - snapshot price per GB/month, net (VAT excluded)
 * @param backupPercentage - Backup feature surcharge percentage (e.g. 20)
 * @param snapshotSizesGb - array of recent snapshot sizes (GB), averaged
 * @param rotation - how many snapshots are retained
 */
export function calculateCosts({
  serverMonthlyPriceNet,
  snapshotPricePerGbNet,
  backupPercentage,
  snapshotSizesGb,
  rotation,
}) {
  const avgSizeGb =
    snapshotSizesGb.length > 0
      ? snapshotSizesGb.reduce((a, b) => a + b, 0) / snapshotSizesGb.length
      : 0;

  const singleSnapshotCost = avgSizeGb * snapshotPricePerGbNet;
  const totalSnapshotCost = singleSnapshotCost * rotation;
  const backupCost = serverMonthlyPriceNet * (backupPercentage / 100);

  return {
    avgSizeGb,
    singleSnapshotCost,
    totalSnapshotCost,
    backupCost,
    backupIsCheaper: backupCost < totalSnapshotCost,
    breakEvenGb: (backupCost / rotation) / snapshotPricePerGbNet,
  };
}
