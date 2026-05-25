/**
 * useAuth — primary hook surface for every module that needs the user
 * or auth actions. Throws if called outside <AuthProvider>, so misuse is
 * caught at dev time instead of returning a null user that silently fails
 * downstream queries.
 */

import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './AuthProvider';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth() called outside <AuthProvider>');
  }
  return ctx;
}
