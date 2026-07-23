import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetchJson } from '../api/http.js';
import './WorkspaceAgentOperationsTab.css';

const POLICY_CONTROLS = [
  { key: 'proactiveEnabled', label: 'Proactive operations', detail: 'Look ahead and work between conversations.' },
  { key: 'emailMonitoring', label: 'Monitor email', detail: 'Watch connected inboxes for urgent or useful work.' },
  { key: 'calendarMonitoring', label: 'Monitor calendar', detail: 'Watch timing, conflicts, deadlines, and upcoming commitments.' },
  { key: 'emailOrganization', label: 'Organize email', detail: 'Label, archive, star, and update read state automatically.' },
  { key: 'draftReplies', label: 'Prepare reply drafts', detail: 'Write drafts proactively. Sending still requires confirmation.' },
  { key: 'personalCalendarHolds', label: 'Create private holds', detail: 'Reserve focus or buffer time without inviting anyone.' },
];

function formatDate(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function actionTone(action) {
  if (action?.status === 'ok') return 'is-pass';
  if (action?.status === 'pending') return 'is-warn';
  return 'is-fail';
}

export default function WorkspaceAgentOperationsTab({ agent, onRunAgentTest }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetchJson('/api/workspace/profile');
      setProfile(data?.profile || null);
    } catch (err) {
      setError(err.message || 'Could not load Workspace Agent operations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const failedChecks = useMemo(
    () => (profile?.readiness?.checks || []).filter((check) => !check.ok),
    [profile]
  );

  const updatePolicy = useCallback(async (key, value) => {
    setSavingKey(key);
    setError('');
    try {
      const data = await apiFetchJson('/api/workspace/profile/policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: { [key]: value } }),
      });
      setProfile((previous) => previous ? {
        ...previous,
        policy: data.policy,
        permissions: data.permissions,
      } : previous);
    } catch (err) {
      setError(err.message || 'Could not update Workspace Agent permissions.');
    } finally {
      setSavingKey('');
    }
  }, []);

  if (loading) {
    return <div className="workspace-ops-state">Loading the Workspace Agent operating profile…</div>;
  }

  if (!profile) {
    return (
      <div className="workspace-ops-state is-error">
        <strong>Workspace Agent operations are unavailable.</strong>
        <span>{error || 'The server did not return an operating profile.'}</span>
        <button type="button" onClick={loadProfile}>Try again</button>
      </div>
    );
  }

  const accounts = profile.connections?.googleAccounts || [];
  const policy = profile.policy || {};
  const monitor = profile.background?.monitor || {};
  const scheduler = profile.background?.scheduler || {};

  return (
    <section className="workspace-ops" aria-label="Workspace Agent operations profile">
      <header className="workspace-ops-hero">
        <div>
          <span className="workspace-ops-eyebrow">Primary operations agent</span>
          <h2>Your email and calendar operator</h2>
          <p>
            The Workspace Agent watches what is coming, performs safe routine work, and brings consequential actions back for your confirmation.
          </p>
        </div>
        <div className={`workspace-ops-readiness ${profile.readiness?.ready ? 'is-ready' : 'needs-attention'}`}>
          <span className="workspace-ops-readiness-dot" aria-hidden="true" />
          <strong>{profile.readiness?.ready ? 'Ready for proactive work' : 'Needs setup attention'}</strong>
          <small>{failedChecks.length ? `${failedChecks.length} readiness check${failedChecks.length === 1 ? '' : 's'} need attention` : 'All operating checks passed'}</small>
        </div>
      </header>

      {error && <div className="workspace-ops-alert">{error}</div>}

      <div className="workspace-ops-grid workspace-ops-grid-top">
        <article className="workspace-ops-card workspace-ops-card-wide">
          <div className="workspace-ops-card-heading">
            <div>
              <span className="workspace-ops-kicker">Proactive behavior</span>
              <h3>What it may do between conversations</h3>
            </div>
            <span className="workspace-ops-safety-note">Sending and destructive actions always pause</span>
          </div>
          <div className="workspace-ops-controls">
            {POLICY_CONTROLS.map((control) => (
              <label className="workspace-ops-control" key={control.key}>
                <span>
                  <strong>{control.label}</strong>
                  <small>{control.detail}</small>
                </span>
                <input
                  type="checkbox"
                  checked={policy[control.key] !== false}
                  disabled={Boolean(savingKey)}
                  onChange={(event) => updatePolicy(control.key, event.target.checked)}
                />
                <span className="workspace-ops-switch" aria-hidden="true"><i /></span>
              </label>
            ))}
          </div>
          <label className="workspace-ops-batch">
            <span>
              <strong>Automatic email batch limit</strong>
              <small>Larger batches require an exact confirmation.</small>
            </span>
            <input
              type="number"
              min="1"
              max="100"
              value={policy.maxAutomaticBatchSize || 25}
              disabled={Boolean(savingKey)}
              onChange={(event) => updatePolicy('maxAutomaticBatchSize', Number(event.target.value))}
            />
          </label>
        </article>

        <article className="workspace-ops-card">
          <span className="workspace-ops-kicker">Readiness</span>
          <h3>Operating checks</h3>
          <div className="workspace-ops-checks">
            {(profile.readiness?.checks || []).map((check) => (
              <div className="workspace-ops-check" key={check.id}>
                <span className={check.ok ? 'is-pass' : 'is-fail'}>{check.ok ? '✓' : '!'}</span>
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="workspace-ops-permissions">
        <article className="workspace-ops-permission is-automatic">
          <span>Runs automatically</span>
          <ul>{(profile.permissions?.automatic || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article className="workspace-ops-permission is-confirmation">
          <span>Requires your confirmation</span>
          <ul>{(profile.permissions?.confirmation || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
        <article className="workspace-ops-permission is-blocked">
          <span>Blocked by policy</span>
          <ul>{(profile.permissions?.blocked || []).map((item) => <li key={item}>{item}</li>)}</ul>
        </article>
      </div>

      <div className="workspace-ops-grid">
        <article className="workspace-ops-card">
          <span className="workspace-ops-kicker">Connections and background work</span>
          <h3>Live operating surface</h3>
          <dl className="workspace-ops-facts">
            <div><dt>Google accounts</dt><dd>{accounts.length ? accounts.map((item) => item.email).join(', ') : 'None connected'}</dd></div>
            <div><dt>Background monitor</dt><dd>{monitor.running ? 'Running' : 'Not running'}{monitor.policySkipReason ? ` — ${monitor.policySkipReason}` : ''}</dd></div>
            <div><dt>Last email check</dt><dd>{formatDate(monitor.lastEmailCheckAt)}</dd></div>
            <div><dt>Daily briefing</dt><dd>{scheduler.running ? `Scheduled at ${String(scheduler.briefingHour).padStart(2, '0')}:${String(scheduler.briefingMinute).padStart(2, '0')}` : 'Not running'}</dd></div>
          </dl>
        </article>

        <article className="workspace-ops-card">
          <div className="workspace-ops-card-heading">
            <div><span className="workspace-ops-kicker">Validation</span><h3>Permission harness</h3></div>
            <button type="button" className="workspace-ops-test" onClick={() => onRunAgentTest?.(agent)}>Run test</button>
          </div>
          <p className="workspace-ops-copy">Runs deterministic safety cases without sending email or changing a real calendar, then saves the evidence to this profile.</p>
          <div className="workspace-ops-metrics">
            <div><strong>{profile.counts?.memory ?? '—'}</strong><span>memories</span></div>
            <div><strong>{profile.counts?.activeRules ?? '—'}</strong><span>active rules</span></div>
            <div><strong>{profile.counts?.conversations ?? '—'}</strong><span>conversations</span></div>
            <div><strong>{profile.counts?.actions ?? '—'}</strong><span>action records</span></div>
          </div>
        </article>
      </div>

      <article className="workspace-ops-card workspace-ops-evidence">
        <div className="workspace-ops-card-heading">
          <div><span className="workspace-ops-kicker">Durable evidence</span><h3>Recent policy decisions and actions</h3></div>
          <button type="button" className="workspace-ops-refresh" onClick={loadProfile}>Refresh</button>
        </div>
        {profile.recentActions?.length ? (
          <div className="workspace-ops-action-list">
            {profile.recentActions.map((action) => (
              <div className="workspace-ops-action" key={action._id}>
                <span className={`workspace-ops-action-status ${actionTone(action)}`}>{action.status}</span>
                <div><strong>{action.tool}</strong><small>{action.resultSummary || action.error || action.target || 'No summary recorded.'}</small></div>
                <span>{action.surface || action.source}</span>
                <time>{formatDate(action.createdAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="workspace-ops-empty">No durable Workspace Agent actions have been recorded yet.</p>
        )}
      </article>
    </section>
  );
}
