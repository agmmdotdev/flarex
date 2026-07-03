export type JSONValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JSONValue>
  | { readonly [key: string]: JSONValue };

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
