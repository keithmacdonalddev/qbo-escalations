import { useCallback, useEffect, useState } from 'react';
import {
  getSummary,
  getCategoryBreakdown,
  getTopAgents,
  getRecurringIssues,
  getResolutionTimes,
  getTrends,
  getTodaySnapshot,
  getStatusFlow,
  getModelPerformance,
} from '../api/analyticsApi.js';

const ANALYTICS_SECTION_TIMEOUT_MS = 12_000;

function withSectionTimeout(label, promise, timeoutMs = ANALYTICS_SECTION_TIMEOUT_MS) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

export default function useAnalytics() {
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [agents, setAgents] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [resolutionTimes, setResolutionTimes] = useState([]);
  const [trends, setTrends] = useState([]);
  const [today, setToday] = useState(null);
  const [statusFlow, setStatusFlow] = useState({ total: 0, flow: {} });
  const [modelPerf, setModelPerf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const loadData = useCallback(async (signal) => {
    setLoading(true);
    setFetchError(null);
    const sections = [
      { key: 'summary', label: 'summary', load: () => getSummary(), apply: setSummary, fallback: null },
      { key: 'categories', label: 'categories', load: () => getCategoryBreakdown(), apply: setCategories, fallback: [] },
      { key: 'agents', label: 'agents', load: () => getTopAgents(10), apply: setAgents, fallback: [] },
      { key: 'recurring', label: 'recurring issues', load: () => getRecurringIssues(8), apply: setRecurring, fallback: [] },
      { key: 'resolutionTimes', label: 'resolution times', load: () => getResolutionTimes(), apply: setResolutionTimes, fallback: [] },
      { key: 'trends', label: 'daily trends', load: () => getTrends('daily'), apply: setTrends, fallback: [] },
      { key: 'today', label: 'today snapshot', load: () => getTodaySnapshot(), apply: setToday, fallback: null },
      { key: 'statusFlow', label: 'status flow', load: () => getStatusFlow(), apply: setStatusFlow, fallback: { total: 0, flow: {} } },
      { key: 'modelPerf', label: 'model performance', load: () => getModelPerformance(), apply: setModelPerf, fallback: null },
    ];

    const results = await Promise.allSettled(
      sections.map((section) => withSectionTimeout(section.label, section.load())),
    );

    if (signal?.aborted) return;

    const failedSections = [];
    results.forEach((result, index) => {
      const section = sections[index];
      if (result.status === 'fulfilled') {
        section.apply(result.value);
        return;
      }
      section.apply(section.fallback);
      failedSections.push(section.label);
    });

    if (failedSections.length > 0) {
      setFetchError(
        failedSections.length === sections.length
          ? 'Failed to load analytics data'
          : `Some analytics sections could not load: ${failedSections.join(', ')}`
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadData(ac.signal);
    return () => ac.abort();
  }, [loadData]);

  return {
    summary,
    categories,
    agents,
    recurring,
    resolutionTimes,
    trends,
    today,
    statusFlow,
    modelPerf,
    loading,
    fetchError,
    loadData,
  };
}
