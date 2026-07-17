// adapters/routing/index.ts — RouteProvider contract (WR-003, ARCHITECTURE §4).
import type { CandidateRoute, LatLon, RoundTripParams } from '../../domain';

export interface RouteProvider {
  roundTrip(p: RoundTripParams): Promise<CandidateRoute>;
  /** Out-and-back / rejoin leg between two points. `profile` kept as `string` per ARCHITECTURE §4. */
  pointToPoint(a: LatLon, b: LatLon, profile: string): Promise<CandidateRoute>;
}

export type {
  CandidateRoute,
  LatLon,
  RoundTripParams,
  RouteProfile,
  Segment,
  TurnStep,
} from '../../domain';
