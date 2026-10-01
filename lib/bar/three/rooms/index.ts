import type { RoomBuilder } from "../types";
import { buildKissa } from "./kissa";
import { buildGarden } from "./garden";
import { buildTearoom } from "./tearoom";
import { buildCurator } from "./curator";
import { buildOmakase } from "./omakase";
import { buildBerlin } from "./berlin";
import { buildWarehouse } from "./warehouse";
import { buildPlaya } from "./playa";
import { buildRooftop } from "./rooftop";
import { buildTrattoria } from "./trattoria";
import { buildArchive } from "./archive";
import { buildLabyrinth } from "./labyrinth";
import { buildChamber } from "./chamber";

// scene id (RoomDef.scene) → the builder that makes its low-poly scenery.
// Doors + crates are built by the world for every room (see shared.ts).
export const ROOM_BUILDERS: Record<string, RoomBuilder> = {
  kissa: buildKissa,
  garden: buildGarden,
  tearoom: buildTearoom,
  curator: buildCurator,
  omakase: buildOmakase,
  berlin: buildBerlin,
  warehouse: buildWarehouse,
  playa: buildPlaya,
  rooftop: buildRooftop,
  trattoria: buildTrattoria,
  archive: buildArchive,
  labyrinth: buildLabyrinth,
  chamber: buildChamber,
};
