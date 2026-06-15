import "next-auth";
import type { Role } from "@/types/auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      role: Role;
      orgId: string;
      orgName: string;
      groups: string[];
    };
  }

  interface User {
    id: string;
    email: string;
    role: Role;
    orgId: string;
    orgName: string;
    groups: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    orgId: string;
    orgName: string;
    groups: string[];
  }
}