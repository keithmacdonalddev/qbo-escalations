import { useCallback, useEffect, useRef, useState } from 'react';
import { getDefaultGmailAccount, resolveConnectedAccount } from '../lib/accountDefaults.js';
import { apiFetch } from '../lib/gmail/gmailApi.js';

function sortMessagesNewestFirst(messages = []) {
  return [...messages].sort((a, b) => new Date(b.date) - new Date(a.date));
}

export default function useGmailAccounts({
  isActive = true,
  pageSizeRef,
  showToast,
  setProfile,
  setLabels,
  setMessages,
  setNextPageToken,
  setSelectedMessageId,
  setActiveSearch,
  setSearch,
  setSelectedIds,
  setActiveLabel,
  setActiveCategory,
}) {
  const [initRetry, setInitRetry] = useState(0);
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [authErrorParam, setAuthErrorParam] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [isUnifiedMode, setIsUnifiedMode] = useState(false);
  const [unifiedUnreadCounts, setUnifiedUnreadCounts] = useState({});
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState(null);

  const activeAccountRef = useRef(activeAccount);
  const unifiedFetchIdRef = useRef(0);

  useEffect(() => {
    activeAccountRef.current = activeAccount;
  }, [activeAccount]);

  const resolvePreferredAccount = useCallback((accountList, fallbackEmail = '') => {
    return resolveConnectedAccount(accountList, getDefaultGmailAccount(), fallbackEmail);
  }, []);

  const clearActiveMailboxData = useCallback(() => {
    setProfile(null);
    setMessages([]);
    setLabels([]);
    setNextPageToken(null);
  }, [setLabels, setMessages, setNextPageToken, setProfile]);

  const loadBootstrapAccountData = useCallback(async (accountEmail) => {
    const [profileRes, labelsRes, messagesRes] = await Promise.all([
      apiFetch('/profile', {}, accountEmail),
      apiFetch('/labels', {}, accountEmail),
      apiFetch(`/messages?maxResults=${pageSizeRef.current}&labelIds=INBOX`, {}, accountEmail),
    ]);

    if (!profileRes.ok && profileRes.code === 'GMAIL_NOT_CONNECTED') {
      return { ok: false, status: 'not-connected' };
    }
    if (!profileRes.ok) {
      return { ok: false, status: 'error', error: profileRes.error || 'Failed to load Gmail' };
    }

    setProfile(profileRes);
    setLabels(labelsRes.ok ? labelsRes.labels : []);
    if (messagesRes.ok) {
      setMessages(messagesRes.messages);
      setNextPageToken(messagesRes.nextPageToken);
    }

    return { ok: true };
  }, [pageSizeRef, setLabels, setMessages, setNextPageToken, setProfile]);

  const loadSwitchedAccountData = useCallback(async (accountEmail) => {
    const [profileRes, labelsRes, messagesRes] = await Promise.all([
      apiFetch('/profile', {}, accountEmail),
      apiFetch('/labels', {}, accountEmail),
      apiFetch(`/messages?maxResults=${pageSizeRef.current}&labelIds=INBOX`, {}, accountEmail),
    ]);

    if (profileRes.ok) {
      setProfile(profileRes);
    }
    setLabels(labelsRes.ok ? labelsRes.labels : []);
    if (messagesRes.ok) {
      setMessages(messagesRes.messages);
      setNextPageToken(messagesRes.nextPageToken);
    }

    return { ok: profileRes.ok };
  }, [pageSizeRef, setLabels, setMessages, setNextPageToken, setProfile]);

  const loadDisconnectedAccountData = useCallback(async (accountEmail) => {
    const [profileRes, labelsRes, messagesRes] = await Promise.all([
      apiFetch('/profile', {}, accountEmail),
      apiFetch('/labels', {}, accountEmail),
      apiFetch(`/messages?maxResults=${pageSizeRef.current}&labelIds=INBOX`, {}, accountEmail),
    ]);

    setProfile(profileRes.ok ? profileRes : null);
    setLabels(labelsRes.ok ? labelsRes.labels : []);
    if (messagesRes.ok) {
      setMessages(messagesRes.messages);
      setNextPageToken(messagesRes.nextPageToken);
    }

    return { ok: profileRes.ok };
  }, [pageSizeRef, setLabels, setMessages, setNextPageToken, setProfile]);

  const loadInboxOnly = useCallback(async (accountEmail) => {
    const [labelsRes, messagesRes] = await Promise.all([
      apiFetch('/labels', {}, accountEmail),
      apiFetch(`/messages?maxResults=${pageSizeRef.current}&labelIds=INBOX`, {}, accountEmail),
    ]);

    setLabels(labelsRes.ok ? labelsRes.labels : []);
    if (messagesRes.ok) {
      setMessages(messagesRes.messages);
      setNextPageToken(messagesRes.nextPageToken);
    }
  }, [pageSizeRef, setLabels, setMessages, setNextPageToken]);

  const syncAuthState = useCallback(async () => {
    const authStatus = await apiFetch('/auth/status');
    if (!authStatus.ok) {
      return { ok: false, status: 'error', error: authStatus.error || 'Failed to check auth status' };
    }

    const nextAccounts = authStatus.accounts || [];
    setAccounts(nextAccounts);

    if (!authStatus.connected) {
      setActiveAccount(null);
      activeAccountRef.current = null;
      return { ok: false, status: 'not-connected' };
    }

    const nextActive = resolvePreferredAccount(nextAccounts, authStatus.activeAccount || authStatus.email);
    if (!nextActive) {
      setActiveAccount(null);
      activeAccountRef.current = null;
      return { ok: false, status: 'not-connected' };
    }

    setActiveAccount(nextActive);
    activeAccountRef.current = nextActive;

    const loadResult = await loadBootstrapAccountData(nextActive);
    if (!loadResult.ok) {
      return loadResult;
    }

    return { ok: true, activeAccount: nextActive, accounts: nextAccounts };
  }, [loadBootstrapAccountData, resolvePreferredAccount]);

  useEffect(() => {
    const hash = window.location.hash || '';
    const queryStart = hash.indexOf('?');
    if (queryStart === -1) return;

    const params = new URLSearchParams(hash.slice(queryStart));
    const error = params.get('error');
    if (error) {
      setAuthErrorParam(error);
    }

    if (params.has('error') || params.has('connected')) {
      const cleanHash = hash.slice(0, queryStart);
      window.history.replaceState(null, '', cleanHash || '#/workspace/inbox');
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;
    async function init() {
      try {
        const result = await syncAuthState();
        if (cancelled) return;

        if (!result.ok) {
          if (result.status === 'not-connected') {
            setStatus('not-connected');
            return;
          }
          setErrorMsg(result.error || 'Failed to load Gmail');
          setStatus('error');
          return;
        }

        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err.message || 'Network error');
          setStatus('error');
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [initRetry, isActive, syncAuthState]);

  useEffect(() => {
    if (!isActive || status !== 'ready' || !isUnifiedMode || accounts.length < 2) return;

    let cancelled = false;
    const fetchUnreadCounts = async () => {
      try {
        const res = await apiFetch('/unified/unread-counts');
        if (!cancelled && res.ok && res.counts) {
          setUnifiedUnreadCounts(res.counts);
        }
      } catch {
        // Ignore polling failures.
      }
    };

    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accounts.length, isActive, isUnifiedMode, status]);

  const handleRetryBootstrap = useCallback(() => {
    setErrorMsg('');
    setStatus('loading');
    setInitRetry((count) => count + 1);
  }, []);

  const handleConnected = useCallback(() => {
    setStatus('loading');
    setAuthErrorParam(null);

    async function reload() {
      try {
        const result = await syncAuthState();
        if (!result.ok) {
          if (result.status === 'not-connected') {
            setStatus('not-connected');
            return;
          }
          setStatus('not-connected');
          return;
        }
        setStatus('ready');
      } catch {
        setStatus('not-connected');
      }
    }

    reload();
  }, [syncAuthState]);

  const handleDisconnect = useCallback(async (emailToDisconnect) => {
    const targetEmail = emailToDisconnect || disconnectTarget || activeAccount;
    setDisconnecting(true);

    try {
      const body = targetEmail ? JSON.stringify({ email: targetEmail }) : undefined;
      const res = await apiFetch('/auth/disconnect', {
        method: 'POST',
        ...(body ? { body } : {}),
      });

      if (!res.ok) return;

      const statusRes = await apiFetch('/auth/status');
      if (statusRes.ok && statusRes.connected) {
        const nextAccounts = statusRes.accounts || [];
        setAccounts(nextAccounts);

        const newActive = resolvePreferredAccount(nextAccounts, statusRes.activeAccount || statusRes.email);
        setActiveAccount(newActive);
        activeAccountRef.current = newActive;
        setShowDisconnect(false);
        setDisconnectTarget(null);
        showToast?.(`Disconnected ${targetEmail}`);

        if (newActive) {
          await loadDisconnectedAccountData(newActive);
        }
      } else {
        setAccounts([]);
        setActiveAccount(null);
        activeAccountRef.current = null;
        setStatus('not-connected');
        clearActiveMailboxData();
        setShowDisconnect(false);
        setDisconnectTarget(null);
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  }, [activeAccount, clearActiveMailboxData, disconnectTarget, loadDisconnectedAccountData, resolvePreferredAccount, showToast]);

  const handleSwitchAccount = useCallback(async (email) => {
    try {
      setIsUnifiedMode(false);

      const res = await apiFetch('/accounts/switch', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      if (!res.ok) return;

      setActiveAccount(email);
      activeAccountRef.current = email;
      setSelectedMessageId(null);
      setActiveSearch('');
      setSearch('');
      setActiveLabel('INBOX');
      showToast?.(`Switched to ${email}`);

      await loadSwitchedAccountData(email);
    } catch (err) {
      showToast?.('Failed to switch account: ' + (err.message || 'Unknown error'));
    }
  }, [loadSwitchedAccountData, setActiveLabel, setActiveSearch, setSearch, setSelectedMessageId, showToast]);

  const handleToggleUnified = useCallback(() => {
    const nextUnified = !isUnifiedMode;
    setIsUnifiedMode(nextUnified);

    setSelectedMessageId(null);
    setActiveSearch('');
    setSearch('');
    setSelectedIds(new Set());
    setMessages([]);
    setNextPageToken(null);
    setActiveLabel(nextUnified ? null : 'INBOX');
    setActiveCategory('all');

    if (nextUnified) {
      const requestId = ++unifiedFetchIdRef.current;
      apiFetch(`/unified?maxResults=${pageSizeRef.current}`)
        .then((res) => {
          if (requestId !== unifiedFetchIdRef.current || !res.ok) return null;
          const msgs = sortMessagesNewestFirst(res.messages || []);
          setMessages(msgs);
          setNextPageToken(res.nextPageToken || null);
          return true;
        })
        .catch(() => {});

      apiFetch('/unified/unread-counts')
        .then((res) => {
          if (res.ok && res.counts) {
            setUnifiedUnreadCounts(res.counts);
          }
        })
        .catch(() => {});

      showToast?.('Unified Inbox — showing all accounts');
      return;
    }

    const email = activeAccountRef.current;
    if (email) {
      loadInboxOnly(email).catch(() => {});
    }
    showToast?.(`Showing ${activeAccountRef.current || 'single account'}`);
  }, [activeAccountRef, isUnifiedMode, loadInboxOnly, pageSizeRef, setActiveCategory, setActiveLabel, setActiveSearch, setMessages, setNextPageToken, setSearch, setSelectedIds, setSelectedMessageId, showToast]);

  const handleAddAccount = useCallback(async () => {
    try {
      const data = await apiFetch('/auth/url');
      if (data.ok && data.url) {
        window.location.href = data.url;
      } else {
        showToast?.(data.error || 'Failed to start OAuth flow');
      }
    } catch (err) {
      showToast?.('Failed to add account: ' + (err.message || 'Unknown error'));
    }
  }, [showToast]);

  const handleDisconnectAccount = useCallback((email) => {
    setDisconnectTarget(email);
    setShowDisconnect(true);
  }, []);

  const closeDisconnectDialog = useCallback(() => {
    setShowDisconnect(false);
    setDisconnectTarget(null);
  }, []);

  return {
    activeAccount,
    activeAccountRef,
    accounts,
    authErrorParam,
    closeDisconnectDialog,
    disconnectTarget,
    disconnecting,
    errorMsg,
    handleAddAccount,
    handleConnected,
    handleDisconnect,
    handleDisconnectAccount,
    handleRetryBootstrap,
    handleSwitchAccount,
    handleToggleUnified,
    isUnifiedMode,
    showDisconnect,
    status,
    unifiedUnreadCounts,
  };
}
