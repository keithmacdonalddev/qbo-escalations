import { DEFAULT_DOMAIN_FOLDER_MAP, SYSTEM_ONLY_LABEL_IDS, extractDomain } from './gmailInboxHelpers.jsx';

export function buildFolderSuggestions(messages, labels, dismissedSuggestions = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if (!Array.isArray(labels) || labels.length === 0) return [];

  const labelNameToId = {};
  const labelIdToName = {};
  for (const label of labels) {
    if (label?.type !== 'user') continue;
    const name = typeof label.name === 'string' ? label.name.toLowerCase() : '';
    if (!name) continue;
    labelNameToId[name] = label.id;
    labelIdToName[label.id] = label.name;
  }

  const labelDomainCounts = {};
  for (const msg of messages) {
    const userLabelIds = (msg.labels || []).filter((lid) => !SYSTEM_ONLY_LABEL_IDS.has(lid));
    if (userLabelIds.length === 0) continue;
    const domain = extractDomain(msg.fromEmail || msg.from || '');
    if (!domain) continue;
    for (const lid of userLabelIds) {
      if (!labelDomainCounts[lid]) labelDomainCounts[lid] = {};
      labelDomainCounts[lid][domain] = (labelDomainCounts[lid][domain] || 0) + 1;
    }
  }

  const dynamicMap = {};
  for (const [lid, domains] of Object.entries(labelDomainCounts)) {
    const totalForLabel = Object.values(domains).reduce((sum, count) => sum + count, 0);
    for (const [domain, count] of Object.entries(domains)) {
      if (count >= 3 || (totalForLabel > 0 && count / totalForLabel >= 0.6)) {
        dynamicMap[domain] = labelIdToName[lid] || lid;
      }
    }
  }

  const mergedMap = { ...DEFAULT_DOMAIN_FOLDER_MAP, ...dynamicMap };
  const domainBuckets = {};
  for (const msg of messages) {
    const userLabelIds = (msg.labels || []).filter((lid) => !SYSTEM_ONLY_LABEL_IDS.has(lid));
    if (userLabelIds.length > 0) continue;
    const domain = extractDomain(msg.fromEmail || msg.from || '');
    if (!domain || !mergedMap[domain]) continue;
    const folderName = mergedMap[domain];
    const key = `${domain}::${folderName}`;
    if (!domainBuckets[key]) domainBuckets[key] = [];
    domainBuckets[key].push(msg.id);
  }

  const suggestions = [];
  for (const [key, msgIds] of Object.entries(domainBuckets)) {
    if (dismissedSuggestions[key]) continue;
    const [domain, folderName] = key.split('::');
    const labelId = labelNameToId[folderName.toLowerCase()] || null;
    suggestions.push({ domain, folderName, labelId, messageIds: msgIds, key });
  }

  suggestions.sort((a, b) => b.messageIds.length - a.messageIds.length);
  return suggestions;
}
