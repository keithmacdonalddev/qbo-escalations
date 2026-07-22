import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiFetchJson } from '../api/http.js';
import ProviderSpendingCard from './ProviderSpendingCard.jsx';

vi.mock('../api/http.js', () => ({ apiFetchJson: vi.fn() }));

const missingOpenAi = {
  providerId: 'openai',
  summary: 'Provider-reported organization spend requires a separate OpenAI Admin API key.',
  canRefresh: true,
  setupUrl: 'https://platform.openai.com/settings/organization/admin-keys',
  billingUrl: 'https://platform.openai.com/usage',
  credential: {
    configured: false,
    source: 'missing',
    label: 'Admin key',
    uiManaged: true,
  },
  providerReport: null,
  lastSuccessfulAt: null,
  lastError: null,
  localObserved: {
    available: true,
    requests: 2,
    spendUsd: 0.25,
    fullyCostedPercent: 100,
  },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('ProviderSpendingCard', () => {
  it('lets the user save and check an admin reporting key entirely in the UI', async () => {
    const user = userEvent.setup();
    const configured = {
      ...missingOpenAi,
      credential: { ...missingOpenAi.credential, configured: true, source: 'saved' },
    };
    const checked = {
      ...configured,
      providerReport: { kind: 'organization-spend', spendUsd: 3.5 },
      lastSuccessfulAt: '2026-07-21T23:45:00.000Z',
    };
    apiFetchJson
      .mockResolvedValueOnce({ ok: true, spending: missingOpenAi })
      .mockResolvedValueOnce({ ok: true, spending: configured })
      .mockResolvedValueOnce({ ok: true, spending: checked });

    render(<ProviderSpendingCard providerId="openai" />);

    const keyInput = await screen.findByLabelText('Admin key');
    const saveButton = screen.getByRole('button', { name: 'Save & check' });
    expect(saveButton).toBeDisabled();
    await user.type(keyInput, 'admin-key-from-ui');
    await user.click(saveButton);

    await waitFor(() => expect(apiFetchJson).toHaveBeenCalledTimes(3));
    expect(apiFetchJson.mock.calls[1][0]).toBe('/api/ai-management/spending/openai/credential');
    expect(JSON.parse(apiFetchJson.mock.calls[1][1].body)).toEqual({ key: 'admin-key-from-ui' });
    expect(apiFetchJson.mock.calls[2][0]).toBe('/api/ai-management/spending/openai/refresh');
    expect(await screen.findByText('$3.50')).toBeVisible();
    expect(screen.queryByDisplayValue('admin-key-from-ui')).not.toBeInTheDocument();
    expect(screen.getByText(/Saved secrets are never returned/)).toBeVisible();
  });

  it('does not invent a reporting-key field when the provider has no billing endpoint', async () => {
    apiFetchJson.mockResolvedValueOnce({
      ok: true,
      spending: {
        providerId: 'gemini',
        reportingMode: 'billing-page-only',
        summary: 'Google exposes the current balance in AI Studio.',
        canRefresh: false,
        setupUrl: null,
        billingUrl: 'https://aistudio.google.com/app/billing',
        credential: { configured: true, source: 'not-required', uiManaged: false },
        providerReport: null,
        localObserved: { available: true, requests: 0, spendUsd: 0, fullyCostedPercent: 0 },
      },
    });

    render(<ProviderSpendingCard providerId="gemini" />);

    expect(await screen.findByRole('link', { name: 'Open billing' })).toBeVisible();
    expect(screen.getByText('Balance is available in the billing portal')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check spending' })).not.toBeInTheDocument();
  });
});
