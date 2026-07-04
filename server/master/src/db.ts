import { MongoClient, type Db, type Collection, ObjectId } from "mongodb";
import type { ItemStack, RoomState } from "@fantasy-mmo/common";

export interface AccountDoc {
  _id?: ObjectId;
  username: string;
  passwordHash: string;
  roles: string[];
  createdAt: Date;
}

export interface SessionDoc {
  _id?: ObjectId;
  token: string;
  accountId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export interface CharacterDoc {
  _id?: ObjectId;
  accountId: ObjectId;
  name: string;
  level: number;
  xp: number;
  gold: number;
  inventory: Array<ItemStack | null>;
  roomId: string;
  x: number | null; // null = use room spawn
  y: number | null;
  z: number | null;
  yaw: number;
  createdAt: Date;
}

export interface RoomRegistryDoc {
  _id?: ObjectId;
  roomId: string;
  shardId: string | null;
  status: "open" | "opening" | "down";
  gameHost: string | null;
  port: number | null;
  updatedAt: Date;
}

export interface RoomStateDoc {
  _id?: ObjectId;
  roomId: string;
  state: RoomState;
  updatedAt: Date;
}

export interface Collections {
  accounts: Collection<AccountDoc>;
  sessions: Collection<SessionDoc>;
  characters: Collection<CharacterDoc>;
  roomRegistry: Collection<RoomRegistryDoc>;
  roomStates: Collection<RoomStateDoc>;
}

export async function connectDb(mongoUrl: string): Promise<{ client: MongoClient; db: Db; cols: Collections }> {
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db();
  const cols: Collections = {
    accounts: db.collection("accounts"),
    sessions: db.collection("sessions"),
    characters: db.collection("characters"),
    roomRegistry: db.collection("roomRegistry"),
    roomStates: db.collection("roomStates"),
  };
  await cols.accounts.createIndex({ username: 1 }, { unique: true });
  await cols.sessions.createIndex({ token: 1 }, { unique: true });
  await cols.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await cols.characters.createIndex({ accountId: 1 });
  await cols.characters.createIndex({ name: 1 }, { unique: true });
  await cols.roomRegistry.createIndex({ roomId: 1 }, { unique: true });
  await cols.roomStates.createIndex({ roomId: 1 }, { unique: true });
  return { client, db, cols };
}
