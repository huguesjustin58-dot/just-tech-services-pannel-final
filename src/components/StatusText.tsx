import React from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  PauseCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { LicenseStatus, PaymentStatus } from '../types/panel';

export const LicenseStatusText: React.FC<{ status: LicenseStatus }> = ({ status }) => {
  switch (status) {
    case 'Active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#45D7F4] whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Active
        </span>
      );
    case 'En provisionnement':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#547CFF] whitespace-nowrap">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          En provisionnement
        </span>
      );
    case 'En attente':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F59E0B] whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          En attente
        </span>
      );
    case 'Suspendue':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F59E0B] whitespace-nowrap">
          <PauseCircle className="w-3.5 h-3.5 shrink-0" />
          Suspendue
        </span>
      );
    case 'Quota épuisé':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FB7185] whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Quota épuisé
        </span>
      );
    case 'Expirée':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8D9AAF] whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          Expirée
        </span>
      );
    case 'Révoquée':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444] whitespace-nowrap">
          <Ban className="w-3.5 h-3.5 shrink-0" />
          Révoquée
        </span>
      );
  }
};

export const PaymentStatusText: React.FC<{ status: PaymentStatus }> = ({ status }) => {
  switch (status) {
    case 'Validé':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#45D7F4] whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Validé
        </span>
      );
    case 'En vérification':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#547CFF] whitespace-nowrap">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          En vérification
        </span>
      );
    case 'Déclaré':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F59E0B] whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Déclaré
        </span>
      );
    case 'Refusé':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#EF4444] whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          Refusé
        </span>
      );
  }
};
