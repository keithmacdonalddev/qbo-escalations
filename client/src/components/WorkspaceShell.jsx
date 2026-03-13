import { useEffect, useMemo } from 'react';
import GmailInbox from './GmailInbox.jsx';
import CalendarView from './CalendarView.jsx';

const WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'projects', label: 'Projects' },
];

function workspaceHashForSubview(subview) {
  return subview === 'overview' ? '#/workspace' : `#/workspace/${subview}`;
}

function WorkspacePlaceholder({ title, body, ctaLabel, ctaHash }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'flex-start',
      gap: 16,
      height: '100%',
      padding: '32px',
      background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-raised) 85%, var(--bg)), var(--bg))',
    }}>
      <div style={{
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--accent)',
      }}>
        Workspace
      </div>
      <h2 style={{ margin: 0, fontSize: '28px', lineHeight: 1.1, letterSpacing: '-0.03em' }}>
        {title}
      </h2>
      <p style={{ margin: 0, maxWidth: 560, color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
        {body}
      </p>
      {ctaHash ? (
        <a
          href={ctaHash}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 40,
            padding: '0 18px',
            borderRadius: 999,
            background: 'var(--accent)',
            color: '#fff',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          {ctaLabel}
        </a>
      ) : null}
    </div>
  );
}

function WorkspaceOverview() {
  const cards = [
    {
      title: 'Inbox',
      desc: 'Review email, triage work, and open the workspace agent with email context.',
      hash: '#/workspace/inbox',
    },
    {
      title: 'Calendar',
      desc: 'Review the schedule, edit events, and hand calendar context to the workspace agent.',
      hash: '#/workspace/calendar',
    },
    {
      title: 'Tasks',
      desc: 'Reserved for cross-workspace task orchestration once task data is integrated.',
      hash: '#/workspace/tasks',
    },
    {
      title: 'Projects',
      desc: 'Reserved for project-level planning and rollups as the workspace expands.',
      hash: '#/workspace/projects',
    },
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      padding: '28px 28px 32px',
      minHeight: 0,
      overflow: 'auto',
      background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-raised) 82%, var(--bg)), var(--bg))',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
        }}>
          Workspace
        </div>
        <h1 style={{ margin: 0, fontSize: '34px', lineHeight: 1.05, letterSpacing: '-0.04em' }}>
          One place for inbox, calendar, tasks, and projects.
        </h1>
        <p style={{ margin: 0, maxWidth: 720, color: 'var(--ink-secondary)', lineHeight: 1.65 }}>
          Use this area as the shared control center. The workspace agent, shared monitor stream,
          and future surfaces all hang off this shell instead of each feature opening its own
          duplicate background connections.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}>
        {cards.map((card) => (
          <a
            key={card.title}
            href={card.hash}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '20px',
              borderRadius: 20,
              border: '1px solid color-mix(in srgb, var(--line-subtle) 55%, transparent)',
              background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)',
              color: 'inherit',
              textDecoration: 'none',
              minHeight: 180,
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
            }}
          >
            <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {card.title}
            </div>
            <div style={{ color: 'var(--ink-secondary)', lineHeight: 1.6 }}>
              {card.desc}
            </div>
            <div style={{ marginTop: 'auto', fontSize: '12px', fontWeight: 700, color: 'var(--accent)' }}>
              Open {card.title}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function WorkspaceShell({ chat = null, subview = 'overview', agentDock = null }) {
  const workspaceContext = useMemo(() => ({
    view: 'workspace',
    subview,
  }), [subview]);

  useEffect(() => {
    if (subview === 'inbox' || subview === 'calendar') return;
    agentDock?.onContextChange?.(workspaceContext);
  }, [agentDock, workspaceContext, subview]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 20px',
        borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)',
        background: 'color-mix(in srgb, var(--bg-raised) 90%, transparent)',
        flexWrap: 'wrap',
      }}>
        {WORKSPACE_TABS.map((tab) => {
          const active = tab.id === subview;
          return (
            <a
              key={tab.id}
              href={workspaceHashForSubview(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 34,
                padding: '0 14px',
                borderRadius: 999,
                border: active
                  ? '1px solid color-mix(in srgb, var(--accent) 25%, transparent)'
                  : '1px solid transparent',
                background: active
                  ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                  : 'transparent',
                color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                fontSize: '13px',
                fontWeight: active ? 700 : 600,
                textDecoration: 'none',
              }}
            >
              {tab.label}
            </a>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: subview === 'overview' ? 'block' : 'none', height: '100%' }}>
          <WorkspaceOverview />
        </div>

        <div style={{ display: subview === 'inbox' ? 'flex' : 'none', height: '100%' }}>
          <GmailInbox chat={chat} agentDock={agentDock} isActive={subview === 'inbox'} />
        </div>

        <div style={{ display: subview === 'calendar' ? 'flex' : 'none', height: '100%' }}>
          <CalendarView chat={chat} agentDock={agentDock} isActive={subview === 'calendar'} />
        </div>

        <div style={{ display: subview === 'tasks' ? 'block' : 'none', height: '100%' }}>
          <WorkspacePlaceholder
            title="Tasks are not wired in yet."
            body="This slot is where shared task state should live once tasks are integrated. It belongs under Workspace so task status can share the same monitor, context, and agent surface as inbox and calendar."
            ctaLabel="Back to Overview"
            ctaHash="#/workspace"
          />
        </div>

        <div style={{ display: subview === 'projects' ? 'block' : 'none', height: '100%' }}>
          <WorkspacePlaceholder
            title="Projects are staged behind the Workspace shell."
            body="This view is reserved for higher-level work planning. Keeping it inside Workspace lets future project timelines, task rollups, and inbox/calendar context stay connected instead of becoming another isolated page."
            ctaLabel="Back to Overview"
            ctaHash="#/workspace"
          />
        </div>
      </div>
    </div>
  );
}
