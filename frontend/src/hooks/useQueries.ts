import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHealth,
  getMetrics,
  getModelCatalog,
  getSessions,
  getSessionDetails,
  deleteSession,
  getDashboardWidgets,
  pinDashboardWidget,
  deleteDashboardWidget,
  refreshDashboardWidgets,
} from '../services/api';
import { PinWidgetPayload } from '../types';

export const useHealthQuery = () => {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30000,
  });
};

export const useCatalogQuery = () => {
  return useQuery({
    queryKey: ['models'],
    queryFn: getModelCatalog,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};

export const useSessionsQuery = () => {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => getSessions(50),
  });
};

export const useSessionDetailsQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSessionDetails(sessionId!),
    enabled: !!sessionId,
  });
};

export const useMetricsQuery = () => {
  return useQuery({
    queryKey: ['metrics'],
    queryFn: getMetrics,
  });
};

export const useDashboardQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['dashboard', sessionId],
    queryFn: () => getDashboardWidgets(sessionId!),
    enabled: !!sessionId,
  });
};

export const useDeleteSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
};

export const usePinWidgetMutation = (sessionId?: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PinWidgetPayload) => pinDashboardWidget(payload),
    onSuccess: (_data, variables) => {
      const targetSession = variables.session_id || sessionId;
      if (targetSession) {
        queryClient.invalidateQueries({ queryKey: ['dashboard', targetSession] });
      }
    },
  });
};

export const useDeleteWidgetMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (widgetId: string) => deleteDashboardWidget(widgetId),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['dashboard', sessionId] });
      }
    },
  });
};

export const useRefreshDashboardMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshDashboardWidgets(sessionId!),
    onSuccess: (data) => {
      if (sessionId) {
        queryClient.setQueryData(['dashboard', sessionId], data);
      }
    },
  });
};
