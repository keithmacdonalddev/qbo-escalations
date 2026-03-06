import { promises as fs } from 'node:fs';
import path from 'node:path';

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error('Usage: node mock-agent.mjs <manifest-path>');
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const { workspaceDir, scenario, mergedAttributes, outputFile } = manifest;
  const output = {
    finalResponse: '',
    actions: ['read_file', 'edit_file'],
    metadata: {
      skillsUsed: [],
      verifierLogged: false,
    },
  };

  if (scenario.id === 'summary-expansion-01') {
    await runSummaryScenario(workspaceDir, mergedAttributes, output);
  } else if (scenario.id === 'verifier-followup-01') {
    await runVerifierScenario(workspaceDir, mergedAttributes, output);
  } else if (scenario.id === 'postmortem-skill-01') {
    await runPostmortemScenario(workspaceDir, mergedAttributes, output);
  } else {
    output.finalResponse = 'No scenario handler matched.';
  }

  await fs.writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8');
}

async function runSummaryScenario(workspaceDir, mergedAttributes, output) {
  const reportPath = path.join(workspaceDir, 'docs', 'report.md');
  const report = await fs.readFile(reportPath, 'utf8');
  const deepSummary =
    '## Executive Summary\n' +
    'This update expands the executive summary to match the now much larger report. ' +
    'The revised summary now covers exception mapping drift between the intake queue and the downstream billing ledger, ' +
    'the rollback plan required to contain incorrect retries, and the owner communication gap that delayed escalation. ' +
    'It also calls out customer impact, operational exposure, and the decisions required before a second deployment ' +
    'window is approved so the summary is useful on its own instead of acting like a thin header note.\n';
  const shallowSummary =
    '## Executive Summary\n' +
    'The executive summary was updated to reflect the latest report and remains under review.\n';

  const intentDepth = mergedAttributes.agents?.intentDepth || 'shallow';
  const summaryWorkflow = mergedAttributes.skills?.summaryWorkflow || 'shallow';
  const promptLoad = mergedAttributes.hooks?.promptLoad || 'high';
  const shouldExpand = intentDepth === 'deep' || summaryWorkflow === 'deep' || promptLoad === 'low';
  const replacement = shouldExpand ? deepSummary : shallowSummary;

  await fs.writeFile(reportPath, replaceSection(report, '## Executive Summary', replacement), 'utf8');
  output.metadata.skillsUsed = summaryWorkflow === 'deep' ? ['summary-audit'] : [];
  output.finalResponse = shouldExpand
    ? 'Expanded the summary to cover exception mapping, rollback plan, and owner communication.'
    : 'Updated the executive summary.';
}

async function runVerifierScenario(workspaceDir, mergedAttributes, output) {
  const pendingPath = path.join(workspaceDir, '.claude', 'hooks', 'pending-verification.json');
  const logPath = path.join(workspaceDir, '.claude', 'memory', 'agent-completion-log.md');
  const verifierDiscipline = mergedAttributes.hooks?.verifierDiscipline || 'medium';
  const verifyClaims = mergedAttributes.agents?.verifyClaims || 'medium';
  const pending = JSON.parse(await fs.readFile(pendingPath, 'utf8'));
  const currentLog = await fs.readFile(logPath, 'utf8');

  if (verifierDiscipline === 'high' || verifyClaims === 'strict') {
    const entry =
      '\n**Verifier Review:**\n' +
      '- Date/Time: 2026-03-06 09:00\n' +
      '- Verifier Agent ID: haiku\n' +
      '- Model: claude-haiku-4-5\n' +
      `- Reviewed Agent: ${pending.agent_id}\n` +
      '- Assessment: done\n' +
      '- What Was Missing (if not done): none\n' +
      `- Verification Notes: Blind review completed for ${pending.task_summary} touching ${pending.files_touched}\n`;

    await fs.writeFile(logPath, `${currentLog}${entry}`, 'utf8');
    await fs.rm(pendingPath, { force: true });
    output.metadata.verifierLogged = true;
    output.finalResponse = 'Independent verification was logged and the pending verification file was consumed.';
  } else {
    output.finalResponse = 'Pending verification detected. A verifier should be spawned next.';
  }
}

async function runPostmortemScenario(workspaceDir, mergedAttributes, output) {
  const postmortemPath = path.join(workspaceDir, 'incidents', 'payment-delay-postmortem.md');
  const workflow = mergedAttributes.skills?.postmortemWorkflow || 'minimal';
  const intentDepth = mergedAttributes.agents?.intentDepth || 'shallow';
  const structured = workflow === 'structured' || intentDepth === 'deep';

  const detailedPostmortem =
    '# Payment Delay Post-Mortem\n\n' +
    '## Incident Summary\n' +
    'Payment notifications were delayed after retry jobs saturated the queue and no owner stepped in during the first escalation window.\n\n' +
    '## Root Cause\n' +
    'The retry worker accepted duplicate enqueue events after the timeout threshold changed, which amplified a backlog that was already building behind a slow reconciliation task.\n\n' +
    '## Impact\n' +
    'Finance operations worked with stale payment status for three hours, customer follow-up was delayed, and manual intervention was required to reconcile the largest accounts.\n\n' +
    '## Corrective Actions\n' +
    '- Add duplicate enqueue protection before the retry worker accepts another job.\n' +
    '- Page the on-call owner when the queue remains above threshold for 10 minutes.\n' +
    '- Add a rollback checklist before retry threshold changes can ship.\n\n' +
    '## Owner and Follow-Up\n' +
    'Owner: Payments platform lead\n' +
    'Follow-Up Date: 2026-03-12\n' +
    'Success Metric: queue depth remains below 25 for seven consecutive days after the fix.\n';
  const lightweightPostmortem =
    '# Payment Delay Notes\n\n' +
    'Payments were delayed because the queue backed up. A future follow-up should document ownership and next steps.\n';

  await fs.writeFile(postmortemPath, structured ? detailedPostmortem : lightweightPostmortem, 'utf8');
  output.metadata.skillsUsed = structured ? ['postmortem'] : [];
  output.finalResponse = structured
    ? 'Created a structured post-mortem with owner, root cause, and corrective actions.'
    : 'Created a brief incident note.';
}

function replaceSection(content, heading, replacementSection) {
  const pattern = new RegExp(`(^${escapeRegExp(heading)}\\n)([\\s\\S]*?)(?=^## |^# |\\Z)`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, `${replacementSection}\n`);
  }
  return `${content.trim()}\n\n${replacementSection}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
