/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/bureau/membres/x" }
 */

import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FicheMembrePage from '@/app/bureau/membres/[id]/page';
import { Registry } from '@/components/bureau/Registry';
import { NO_LONGER_VALID_HELP } from '@/components/bureau/AttestationsPanel';
import * as documents from '@/components/bureau/Documents';
import { ROTATE_CARD_WARNING } from '@/components/bureau/MemberLinkPanel';
import { resetSessionCache, saveSession } from '@/lib/bureau/session';
import type { MemberDetail } from '@/lib/bureau/types';
import {
  CATEGORIES,
  calls,
  fakeServer,
  memberDetail,
  memberItem,
  panelReady,
  renderInBureau,
  SESSION,
  settings,
} from './fixtures';

const nav = vi.hoisted(() => ({ params: { id: '' } }));

vi.mock('next/navigation', () => ({
  useParams: () => nav.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/bureau/membres/x',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  resetSessionCache();
  saveSession(SESSION);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CARD_ON = { settings: settings({ features: { membership_card: true } }) };

const AMINATA = memberDetail({
  id: 'aminata',
  name: 'Aminata Diop',
  first_name: 'Aminata',
  last_name: 'Diop',
  member_number: '0001',
  is_up_to_date: true,
  attestations: [],
  missing_periods: [],
});

function server(member: MemberDetail, extra: Parameters<typeof fakeServer>[0] = []) {
  nav.params = { id: member.id };
  return fakeServer([
    ...extra,
    { match: 'membership/categories', body: CATEGORIES },
    { match: /payments\?member_id=/, body: [] },
    { match: /\/whatsapp$/, body: { message: 'Bonjour', wa_url: null } },
    { match: /\/link$/, body: { url: 'https://demo-asso.adhera.africa/m/xxxx', rotated_at: null } },
    { match: `membership/members/${member.id}`, body: member },
  ]);
}

/** F5 : les gestes rares de la fiche vivent dans « Autres actions ». */
async function openMore(user: ReturnType<typeof userEvent.setup>, row: RegExp) {
  await user.click(await screen.findByRole('button', { name: /Autres actions/ }));
  await user.click(screen.getByRole('button', { name: row }));
  await panelReady();
}

/* ──────────────────────────── § 3.1 — le numéro ─────────────────────────── */

describe('F4 § 3.1 — le numéro de membre', () => {
  it('le registre a une colonne « N° » ; un candidat y a une cellule vide, jamais « 0000 »', async () => {
    fakeServer([
      { match: 'membership/categories', body: CATEGORIES },
      {
        match: 'membership/members',
        body: [
          memberItem({ id: 'a', name: 'Aminata Diop', member_number: '0001' }),
          memberItem({ id: 'b', name: 'Candidat Sall', status: 'pending', member_number: null }),
          memberItem({ id: 'c', name: 'Matricule Ba', member_number: 'ASSO-DAKAR-2021-007' }),
        ],
      },
    ]);
    // Le registre complet (« Demandes d’adhésion », « Anciens membres ») et sa colonne « N° ».
    renderInBureau(<Registry status="active" />);
    const table = await screen.findByTestId('member-table');
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('N°');
    const cells = within(table).getAllByTestId('member-number').map((c) => c.textContent);
    expect(cells).toContain('0001');
    expect(cells).toContain('ASSO-DAKAR-2021-007');
    expect(cells).toContain('');
    expect(table.textContent).not.toContain('0000');
    // Sur téléphone, la carte du membre le porte aussi.
    const cards = screen.getAllByTestId('card-member-number').map((c) => c.textContent);
    expect(cards).toEqual(['N° 0001 · ', 'N° ASSO-DAKAR-2021-007 · ']);
  });

  it('la fiche affiche le numéro ; un candidat, une ligne vide', async () => {
    server(AMINATA);
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Aminata Diop' });
    expect(screen.getByText(/· n° 0001 ·/)).toBeInTheDocument();
    cleanup();

    // F5 : la ligne « {type} · n° {numéro} · {téléphone} » — sans numéro, la mention disparaît.
    server({ ...AMINATA, id: 'cand', status: 'pending', member_number: null });
    renderInBureau(<FicheMembrePage />);
    await screen.findByRole('heading', { name: 'Aminata Diop' });
    expect(document.body.textContent).not.toMatch(/n° (0000|—)/);
    expect(screen.queryByText(/n° /)).not.toBeInTheDocument();
  });

  it('le champ « Numéro de membre » à l’édition ; envoyé seulement s’il a changé', async () => {
    const fetchMock = server(AMINATA, [
      { method: 'PUT', match: `membership/members/${AMINATA.id}`, body: AMINATA },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Modifier ses informations/);
    const field = screen.getByLabelText(/Numéro de membre/) as HTMLInputElement;
    expect(field.value).toBe('0001');
    expect(field.maxLength).toBe(32);

    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT')).toHaveLength(1));
    expect(JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string)).not.toHaveProperty('member_number');
  });

  it('un 422 s’affiche SOUS le champ, `errors.member_number[0]` tel quel — « (membre supprimé) » compris', async () => {
    const message = 'Le numéro « 0002 » est déjà porté par Awa Gueye (membre supprimé).';
    const fetchMock = server(AMINATA, [
      {
        method: 'PUT',
        match: `membership/members/${AMINATA.id}`,
        status: 422,
        body: { message: 'Membre invalide.', errors: { member_number: [message] } },
      },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />);
    await openMore(user, /Modifier ses informations/);
    const field = screen.getByLabelText(/Numéro de membre/);
    await user.clear(field);
    await user.type(field, '0002');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(JSON.parse(calls(fetchMock, 'PUT')[0]?.init.body as string).member_number).toBe('0002');
    // Sous le champ : relié à lui, et le champ marqué invalide.
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby') ?? '').not.toBe('');
    const describedBy = (field.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy.some((id) => document.getElementById(id)?.textContent === message)).toBe(true);
    // Le `message` générique reste à l'écart.
    expect(screen.queryByText('Membre invalide.')).not.toBeInTheDocument();
  });

  it('la création ne propose pas le champ : le serveur numérote', async () => {
    const { MemberForm } = await import('@/components/bureau/MemberForm');
    fakeServer([{ match: 'membership/categories', body: CATEGORIES }]);
    renderInBureau(<MemberForm memberTypes="mixte" submitLabel="Ajouter" onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText(/Numéro de membre/)).not.toBeInTheDocument();
  });
});

/* ───────────────────────── § 3.2 — les attestations ─────────────────────── */

describe('F4 § 3.2 — les attestations sur la fiche', () => {
  it('sans `features.membership_card` (serveur antérieur à v3.8.1) : aucun bloc', async () => {
    server(AMINATA);
    renderInBureau(<FicheMembrePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Autres actions/ }));
    expect(screen.queryByRole('button', { name: /Ses attestations/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Délivrer une attestation' })).not.toBeInTheDocument();
  });

  it('`membership_card: false` : aucun bloc non plus', async () => {
    server(AMINATA);
    renderInBureau(<FicheMembrePage />, { settings: settings({ features: { membership_card: false } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Autres actions/ }));
    expect(screen.queryByRole('button', { name: /Ses attestations/ })).not.toBeInTheDocument();
  });

  it('la liste : référence, délivrance, validité, badges « Valide » et « Plus valide » avec l’aide', async () => {
    server({
      ...AMINATA,
      attestations: [
        {
          document_id: 'doc-2',
          reference: 'ATT-2026-NOUVELLE',
          issued_at: '2026-11-02T09:00:00+00:00',
          valid_until: '2027-03-09',
          is_valid: true,
        },
        {
          document_id: 'doc-1',
          reference: 'ATT-2026-9D2E0D3C',
          issued_at: '2026-03-12T09:00:00+00:00',
          valid_until: '2027-03-09',
          is_valid: false,
        },
      ],
    });
    renderInBureau(<FicheMembrePage />, CARD_ON);
    await openMore(userEvent.setup(), /Ses attestations/);
    await screen.findByRole('heading', { name: 'Attestations' });
    const items = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-valid'));
    expect(items.map((li) => li.getAttribute('data-valid'))).toEqual(['true', 'false']);

    expect(within(items[0]!).getByText('Valide')).toBeInTheDocument();
    expect(items[0]!).toHaveTextContent('Délivrée le 2 novembre 2026 · valable jusqu’au 9 mars 2027');
    expect(items[0]!.textContent).not.toContain(NO_LONGER_VALID_HELP);

    expect(within(items[1]!).getByText('Plus valide')).toBeInTheDocument();
    expect(items[1]!).toHaveTextContent(NO_LONGER_VALID_HELP);
    // Chaque ligne a son PDF.
    expect(
      within(items[1]!).getByRole('button', { name: 'Télécharger l’attestation ATT-2026-9D2E0D3C' }),
    ).toBeInTheDocument();
  });

  it('« Délivrer une attestation » : POST, puis le PDF par documents/{id}/pdf, et la fiche relue', async () => {
    const save = vi.spyOn(documents, 'saveBlob').mockImplementation(() => undefined);
    const fetchMock = server(AMINATA, [
      {
        method: 'POST',
        match: `membership/members/${AMINATA.id}/attestation`,
        status: 201,
        body: { document_id: 'doc-9', reference: 'ATT-2026-9D2E0D3C', valid_until: '2027-03-09' },
      },
      { match: 'membership/documents/doc-9/pdf', body: {} },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />, CARD_ON);
    await openMore(user, /Ses attestations/);
    await user.click(await screen.findByRole('button', { name: 'Délivrer une attestation' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe('ATT-2026-9D2E0D3C.pdf');
    expect(calls(fetchMock, 'POST').map((c) => c.url)).toEqual([
      `https://api.eventflow.africa/api/v1/admin/membership/members/${AMINATA.id}/attestation`,
    ]);
    expect(calls(fetchMock).some((c) => c.url.endsWith('membership/documents/doc-9/pdf'))).toBe(true);
    expect(await screen.findByText('Attestation ATT-2026-9D2E0D3C délivrée.')).toBeInTheDocument();
    // La fiche est relue : la nouvelle pièce apparaîtra dans la liste.
    await waitFor(() =>
      expect(
        calls(fetchMock).filter((c) => c.url.endsWith(`membership/members/${AMINATA.id}`)).length,
      ).toBeGreaterThan(1),
    );
  });

  it.each([
    [403, 'not_up_to_date', 'Ce membre n’est pas à jour de sa cotisation : aucune attestation ne peut être délivrée.'],
    [403, 'not_a_member', 'Seul un membre actif peut recevoir une attestation.'],
    [409, 'issuer_missing', 'Renseignez le nom de l’association dans les réglages avant de délivrer une attestation.'],
  ])('un refus %i `%s` s’affiche avec son message', async (status, code, message) => {
    server(AMINATA, [
      { method: 'POST', match: `membership/members/${AMINATA.id}/attestation`, status, body: { message, code } },
    ]);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />, CARD_ON);
    await openMore(user, /Ses attestations/);
    await user.click(await screen.findByRole('button', { name: 'Délivrer une attestation' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    // Aucun forçage.
    expect(screen.queryByRole('button', { name: /quand même|forcer/i })).not.toBeInTheDocument();
  });

  it('un ancien membre : la liste, sans bouton', async () => {
    server({ ...AMINATA, status: 'former', left_at: '2026-10-01', left_reason: 'resigned' });
    renderInBureau(<FicheMembrePage />, CARD_ON);
    await openMore(userEvent.setup(), /Ses attestations/);
    await screen.findByRole('heading', { name: 'Attestations' });
    expect(screen.queryByRole('button', { name: 'Délivrer une attestation' })).not.toBeInTheDocument();
  });
});

/* ─────────────────────── § 3.3 — régénérer le lien ─────────────────────── */

describe('F4 § 3.3 — régénérer le lien', () => {
  async function openConfirm(overrides = {}) {
    server(AMINATA);
    const user = userEvent.setup();
    renderInBureau(<FicheMembrePage />, overrides);
    await openMore(user, /Son lien personnel/);
    await user.click(await screen.findByRole('button', { name: 'Régénérer le lien' }));
    return screen.findByRole('dialog');
  }

  it('avec la carte : la confirmation prévient que la carte et les QR imprimés ne fonctionneront plus', async () => {
    const dialog = await openConfirm(CARD_ON);
    expect(dialog).toHaveTextContent(ROTATE_CARD_WARNING);
    expect(ROTATE_CARD_WARNING).toBe(
      'Sa carte et les QR codes de ses attestations déjà imprimées ne fonctionneront plus.',
    );
  });

  it('sans l’option : la confirmation d’avant, sans parler d’une carte qui n’existe pas', async () => {
    const dialog = await openConfirm();
    expect(dialog).toHaveTextContent('L’ancien lien ne fonctionnera plus.');
    expect(dialog).not.toHaveTextContent(ROTATE_CARD_WARNING);
  });
});

/*
 * § 3.4 — les années sans période (`missing_periods`) : F5 les range avec les
 * autres années de la fiche (repliées si non réclamées, visibles sous `all`).
 * Voir tests/bureau/fiche.test.tsx, « P6 » et « sous `all` ».
 */
