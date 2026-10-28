import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHealth,
  getMetrics,
  getModelCatalog,
  getAPIKeys,
  updateAPIKeys,
  getSessions,
  getSessionDetails,
  deleteSession,
  renameSession,
  getDashboardWidgets,
  pinDashboardWidget,
  deleteDashboardWidget,
  refreshDashboardWidgets,
  uploadSessionFiles,
  getSessionUploadedTables,
  getTableHealth,
} from '../services/api';
import { PinWidgetPayload, UpdateAPIKeysPayload } from '../types';

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

export const useApiKeysQuery = () => {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: getAPIKeys,
  });
};

export const useUpdateApiKeysMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateAPIKeysPayload) => updateAPIKeys(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['models'], data.catalog);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      queryClient.invalidateQueries({ queryKey: ['models'] });
    },
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

export const useRenameSessionMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      renameSession(sessionId, title),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session', variables.sessionId] });
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

export const useSessionUploadedTablesQuery = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['session-uploaded-tables', sessionId],
    queryFn: () => getSessionUploadedTables(sessionId!),
    enabled: !!sessionId,
  });
};

export const useUploadSessionFilesMutation = (sessionId: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => uploadSessionFiles(sessionId!, files),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-uploaded-tables', sessionId] });
      }
    },
  });
};

export const useTableHealthQuery = (sessionId: string | null, tableName: string | null) => {
  return useQuery({
    queryKey: ['table-health', sessionId, tableName],
    queryFn: () => getTableHealth(sessionId || 'default', tableName!),
    enabled: !!tableName,
    staleTime: 1000 * 60 * 5,
  });
};
