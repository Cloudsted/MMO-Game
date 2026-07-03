import { MongoClient, type Db, type Collection, ObjectId } from "mongodb";
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
    inventory: unknown[];
    roomId: string;
    x: number | null;
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
    state: {
        timeOfDay: number;
        savedAt: number;
    };
    updatedAt: Date;
}
export interface Collections {
    accounts: Collection<AccountDoc>;
    sessions: Collection<SessionDoc>;
    characters: Collection<CharacterDoc>;
    roomRegistry: Collection<RoomRegistryDoc>;
    roomStates: Collection<RoomStateDoc>;
}
export declare function connectDb(mongoUrl: string): Promise<{
    client: MongoClient;
    db: Db;
    cols: Collections;
}>;
//# sourceMappingURL=db.d.ts.map