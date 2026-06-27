// GET /api/world — returns the current shared world, advancing it by the real
// time elapsed since the last touch. Also serves as the cron target so the
// world keeps growing even with no visitors.

import { advanceShared } from "./_world";

export default async function handler(_req: unknown, res: any): Promise<void> {
  try {
    const result = await advanceShared();
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    if (!result.shared) {
      // No shared store attached — tell the client to use its local world.
      res.status(200).json({ shared: false });
      return;
    }
    res.status(200).json({ shared: true, ticks: result.ticks, state: result.state });
  } catch (err) {
    res.status(500).json({ shared: false, error: String(err) });
  }
}
