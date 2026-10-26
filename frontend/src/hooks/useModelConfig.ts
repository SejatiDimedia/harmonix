import { useState, useEffect, useCallback } from 'react';
import { HealthStatus, ModelCatalogResponse, EngineType } from '../types';
import { getHealth, getModelCatalog, setActiveModels } from '../services/api';
import { formatModelNameShort } from '../utils/formatters';

interface UseModelConfigProps {
  onNotify?: (message: string) => void;
}

export const useModelConfig = ({ onNotify }: UseModelConfigProps = {}) => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogResponse | null>(null);

  const [activeProvider, setActiveProvider] = useState<string>('groq');
  const [activeModel, setActiveModel] = useState<string>('openai/gpt-oss-120b');
  const [activeAuditorProvider, setActiveAuditorProvider] = useState<string>('auto');
  const [activeAuditorModel, setActiveAuditorModel] = useState<string>('');
  const [engine, setEngineState] = useState<EngineType>('manual');

  const refreshHealth = useCallback(async () => {
    try {
      const data = await getHealth();
      setHealth(data);
    } catch {
      setHealth({
        status: 'offline',
        database_connected: false,
        llm_provider: 'OFFLINE',
        active_model: '',
      });
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const cat = await getModelCatalog();
      setCatalog(cat);
      if (cat.active_config) {
        setActiveProvider(cat.active_config.analyst_provider || 'groq');
        setActiveModel(cat.active_config.analyst_model || '');
        setActiveAuditorProvider(cat.active_config.auditor_provider || 'auto');
        setActiveAuditorModel(cat.active_config.auditor_model || '');
      }
    } catch (e) {
      console.error('Failed to load model catalog:', e);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    loadCatalog();
  }, [refreshHealth, loadCatalog]);

  const selectModel = useCallback(
    async (provider: string, modelId: string) => {
      try {
        await setActiveModels({
          analyst_provider: provider,
          analyst_model: modelId,
          auditor_provider: activeAuditorProvider,
          auditor_model: activeAuditorModel || null,
        });
        setActiveProvider(provider);
        setActiveModel(modelId);
        onNotify?.(`Model aktif: ${provider.toUpperCase()} (${formatModelNameShort(modelId)})`);
        refreshHealth();
      } catch (err: any) {
        onNotify?.(`Error: ${err.message}`);
      }
    },
    [activeAuditorProvider, activeAuditorModel, onNotify, refreshHealth]
  );

  const saveModelModal = useCallback(
    async (payload: {
      analyst_provider: string;
      analyst_model: string;
      auditor_provider: string;
      auditor_model?: string | null;
    }) => {
      await setActiveModels(payload);
      setActiveProvider(payload.analyst_provider);
      setActiveModel(payload.analyst_model);
      setActiveAuditorProvider(payload.auditor_provider);
      setActiveAuditorModel(payload.auditor_model || '');
      onNotify?.(`Model aktif: ${payload.analyst_provider.toUpperCase()} (${formatModelNameShort(payload.analyst_model)})`);
      refreshHealth();
    },
    [onNotify, refreshHealth]
  );

  const setEngine = useCallback(
    (newEngine: EngineType) => {
      setEngineState(newEngine);
      onNotify?.(`Orchestrator: ${newEngine === 'manual' ? 'Manual Loop' : 'LangGraph'}`);
    },
    [onNotify]
  );

  const setSessionModel = useCallback((provider: string, model: string) => {
    setActiveProvider(provider);
    setActiveModel(model);
  }, []);

  return {
    health,
    catalog,
    activeProvider,
    activeModel,
    activeAuditorProvider,
    activeAuditorModel,
    engine,
    setEngine,
    selectModel,
    saveModelModal,
    setSessionModel,
    refreshHealth,
    loadCatalog,
  };
};
