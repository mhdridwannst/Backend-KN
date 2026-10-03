import { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
        tenantId: string | null;
      };
      tenantId?: string | null;
      isSuperAdmin?: boolean;
    }
  }
}

export {};
