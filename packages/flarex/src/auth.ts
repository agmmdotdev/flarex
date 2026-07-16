import type { Json } from "flarex-protocol/json";

export type JSONValue = Json;

export type {
  AuthConfig,
  AuthProvider,
  CustomJwtAlgorithm,
  CustomJwtAuthProvider,
  OidcAuthProvider,
} from "flarex-protocol/auth";

export interface UserIdentity {
  readonly tokenIdentifier: string;
  readonly subject: string;
  readonly issuer: string;
  readonly name?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly nickname?: string;
  readonly preferredUsername?: string;
  readonly profileUrl?: string;
  readonly pictureUrl?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly gender?: string;
  readonly birthday?: string;
  readonly timezone?: string;
  readonly language?: string;
  readonly phoneNumber?: string;
  readonly phoneNumberVerified?: boolean;
  readonly address?: string;
  readonly updatedAt?: string;
  readonly [claim: string]: JSONValue | undefined;
}

export type UserIdentityAttributes = Omit<UserIdentity, "tokenIdentifier">;

export interface Auth {
  getUserIdentity(): Promise<UserIdentity | null>;
}
