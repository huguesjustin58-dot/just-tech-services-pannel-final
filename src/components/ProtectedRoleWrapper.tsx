import React from 'react';
import { SessionRole } from '../types/panel';

interface ProtectedRoleWrapperProps {
  sessionRole: SessionRole;
  allowedRoles: readonly SessionRole[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Enforces role-based UI isolation: children are omitted from the DOM
 * unless the persisted sessionRole matches one of allowedRoles.
 */
export const ProtectedRoleWrapper: React.FC<ProtectedRoleWrapperProps> = ({
  sessionRole,
  allowedRoles,
  fallback = null,
  children,
}) => {
  if (!allowedRoles.includes(sessionRole)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
