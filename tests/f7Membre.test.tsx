/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoinPage, joinSendError } from '@/app/adherer/JoinPage';
import { MemberPage } from '@/app/m/[token]/MemberPage';
import { VerifyPage } from '@/app/v/[code]/VerifyPage';
import { attestationErrorMessage } from '@/components/card/AttestationAction';
import { drawCard, logoBox } from '@/components/card/cardImage';
import { ApiError } from '@/lib/api';
import type { JoinForm } from '@/lib/join';
import type { MemberCard, Verification } from '@/lib/types';
import { fakeResponse, memberCard, payload, TOKEN } from './fixtures';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const UNAVAILABLE = 'Ce service est momentanément indisponible. Contactez votre association.';
const LICENCE = { code: 'license_expired', error_code: 'license_expired', message: 'Votre licence a expiré. Renouvelez pour réactiver votre espace.' };

/* ───────────────── B11 — « Erreur technique » réservée aux pannes réseau ───────────────── */

describe('B11 — la vérification d’une carte', () => {
  const CODE = '5RGF6J9Z2UJX';

  it('un 403 de licence : la phrase de l’association, jamais « Erreur technique »', async () => {
    fetchMock.mockResolvedValue(fakeResponse(403, LICENCE));
    render(<VerifyPage code={CODE} />);
    expect(await screen.findByTestId('unavailable')).toHaveTextContent(UNAVAILABLE);
    expect(screen.queryByText('Erreur technique')).not.toBeInTheDocument();
    // Le message servi parle au bureau : il ne s'affiche pas à un tiers.
    expect(screen.queryByText(/Renouvelez/)).not.toBeInTheDocument();
  });

  it.each(['feature_disabled', 'tenant_inactive', 'trial_expired', 'un_code_a_venir'])(
    'tout 403 (%s) : le même écran',
    async (code) => {
      fetchMock.mockResolvedValue(fakeResponse(403, { code }));
      render(<VerifyPage code={CODE} />);
      expect(await screen.findByTestId('unavailable')).toHaveTextContent(UNAVAILABLE);
    },
  );

  it('un 500 : le serveur a répondu, la connexion n’est pas accusée', async () => {
    fetchMock.mockResolvedValue(fakeResponse(500, {}));
    render(<VerifyPage code={CODE} />);
    await screen.findByText('Service momentanément indisponible');
    expect(screen.queryByText(/Vérifiez votre connexion/)).not.toBeInTheDocument();
  });

  it('une vraie panne réseau : « Erreur technique »', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<VerifyPage code={CODE} />);
    await screen.findByText('Erreur technique');
  });

  it('§23.7 — l’heure de la vérification, composée par le serveur (« heure de Dakar »)', async () => {
    const value: Verification = {
      organisation: { name: 'Association Démo', logo_url: null },
      member: { display_name: 'Aminata Diop', type: 'personne', category_label: null, member_number: null, member_since: null },
      standing: 'up_to_date',
      valid_until: '2027-03-09',
      checked_at: '2026-11-18T10:30:00+00:00',
      checked_at_label: '18 novembre 2026 à 10h30 (heure de Dakar)',
      attestation: null,
    };
    fetchMock.mockResolvedValue(fakeResponse(200, value));
    render(<VerifyPage code={CODE} />);
    expect(await screen.findByTestId('verify-checked-at')).toHaveTextContent(
      'Vérifié le 18 novembre 2026 à 10h30 (heure de Dakar)',
    );
  });
});

describe('B11 — « Adhérer »', () => {
  const FORM: JoinForm = {
    organisation: { name: 'Association Démo', logo_url: null },
    admission_mode: 'bureau',
    categories: [{ id: 25, label: 'Membre actif', amount_formatted: '25 000 FCFA', mode: 'forfait', period_label: 'par an' }],
    referrer: null,
    consent_text: 'J’accepte qu’Association Démo utilise ces informations.',
    ask_region: false,
    email_mode: 'hidden',
    questions: [],
  };

  it('un 403 au chargement : la phrase de l’association', async () => {
    fetchMock.mockResolvedValue(fakeResponse(403, LICENCE));
    render(<JoinPage parrain={null} />);
    expect(await screen.findByTestId('unavailable')).toHaveTextContent(UNAVAILABLE);
    expect(screen.queryByText('Erreur technique')).not.toBeInTheDocument();
  });

  it('un 403 à l’envoi : la même phrase, sous le bouton', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET' ? fakeResponse(200, FORM) : fakeResponse(403, LICENCE),
    );
    render(<JoinPage parrain={null} />);
    await user.type(await screen.findByLabelText(/Votre prénom/), 'Awa');
    await user.type(screen.getByLabelText(/Votre nom/), 'Gueye');
    await user.type(screen.getByLabelText(/Votre numéro WhatsApp/), '77 123 45 67');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Envoyer ma demande/ }));
    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it('les messages d’envoi : « connexion » seulement sans réponse', () => {
    expect(joinSendError(new ApiError(0, null, 'Réseau indisponible'))).toMatch(/Vérifiez votre connexion/);
    expect(joinSendError(new ApiError(500, null, 'Server Error'))).toBe(
      'Votre demande n’a pas pu être envoyée. Réessayez dans un instant : rien n’a été perdu.',
    );
    expect(joinSendError(new ApiError(403, 'trial_expired', 'x'))).toBe(UNAVAILABLE);
    expect(joinSendError(new ApiError(429, null, 'x'))).toBe('Trop de demandes depuis ce téléphone. Réessayez dans une heure.');
  });
});

describe('B11 — la page du membre : le message de la licence ne lui est jamais montré', () => {
  it('l’attestation refusée pour la licence : la phrase de l’association', () => {
    expect(attestationErrorMessage(new ApiError(403, 'license_expired', 'Votre licence a expiré.'))).toBe(UNAVAILABLE);
    // Contre-épreuve : un refus métier garde son message, rédigé pour le membre (§16.3).
    expect(attestationErrorMessage(new ApiError(403, 'not_up_to_date', 'Votre cotisation n’est pas à jour.'))).toBe(
      'Votre cotisation n’est pas à jour.',
    );
  });
});

/* ───────────────────────────── La carte, la page ───────────────────────────── */

describe('la vue « carte » : la barre « Ma cotisation » colle au haut de l’écran', () => {
  it('elle remonte de tout le `pt-6` de la page (plus de bande de 8 px)', async () => {
    window.history.replaceState({}, '', '/m/aaaa?vue=carte');
    fetchMock.mockResolvedValue(fakeResponse(200, payload({ card: memberCard() })));
    render(<MemberPage token={TOKEN} />);
    const back = await screen.findByTestId('back-to-dues');
    expect(back.className).toContain('-mt-6');
    expect(back.className).not.toContain('-mt-4');
    window.history.replaceState({}, '', '/m/aaaa');
  });
});

describe('« Ce que vous avez envoyé » : une question sans réponse n’y figure pas', () => {
  it('ni la question, ni « Pas de réponse »', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(
        200,
        payload({
          answers: [
            { question_id: 1, label: 'Profession', type: 'text', value_label: 'Enseignante' },
            { question_id: 2, label: 'Pièce d’identité', type: 'file', value_label: null },
          ],
        }),
      ),
    );
    render(<MemberPage token={TOKEN} />);
    const sent = await screen.findByTestId('sent');
    expect(sent).toHaveTextContent('Enseignante');
    expect(sent).not.toHaveTextContent('Pièce d’identité');
    expect(sent).not.toHaveTextContent('Pas de réponse');
  });
});

/* ───────────────────── L'image de la carte porte le logo (F7) ───────────────────── */

type Draw = { op: string; args: unknown[] };

/** Un canevas qui ENREGISTRE ce qu'on y dessine : jsdom n'en a pas. */
function fakeCanvases() {
  const canvases: Array<{ width: number; height: number; draws: Draw[] }> = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return create(tag);
    const record = { width: 0, height: 0, draws: [] as Draw[] };
    canvases.push(record);
    const ctx = new Proxy(
      { measureText: (text: string) => ({ width: text.length * 20 }) } as Record<string, unknown>,
      {
        get(target, key: string) {
          if (key in target) return target[key];
          return (...args: unknown[]) => record.draws.push({ op: key, args });
        },
        set(target, key: string, value) {
          target[key] = value;
          return true;
        },
      },
    );
    return {
      get width() {
        return record.width;
      },
      set width(v: number) {
        record.width = v;
      },
      get height() {
        return record.height;
      },
      set height(v: number) {
        record.height = v;
      },
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,',
      toBlob: (done: (b: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return canvases;
}

describe('« Enregistrer ma carte dans mes photos » : le logo de l’association, comme à l’écran', () => {
  const LOGO = { width: 400, height: 200 };

  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => LOGO));
  });

  async function drawn(card: MemberCard) {
    const canvases = fakeCanvases();
    await drawCard(card);
    // Le premier canevas mesure ; le second est la carte.
    return canvases.at(-1)!;
  }

  it('avec logo : tiré en BLOB depuis l’API, posé au-dessus du nom, sans être déformé', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, blob: async () => new Blob(['logo']) }));
    const card = memberCard({ photo_url: null });
    const canvas = await drawn(card);
    expect(fetchMock).toHaveBeenCalledWith(card.logo_url, expect.objectContaining({ referrerPolicy: 'no-referrer' }));
    const images = canvas.draws.filter((d) => d.op === 'drawImage');
    expect(images).toHaveLength(1);
    // 400 × 200 dans un carré de 176 : 176 × 88, centré.
    const [bitmap, x, y, w, h] = images[0]!.args as [unknown, number, number, number, number];
    expect(bitmap).toBe(LOGO);
    expect([w, h]).toEqual([176, 88]);
    expect(x).toBe(540 - 88);
    expect(y).toBe(72);
    // Le nom de l'association vient APRÈS le logo.
    const org = canvas.draws.find((d) => d.op === 'fillText' && d.args[0] === 'Cercle des Administrateurs Publics');
    expect(org?.args[2]).toBe(72 + 88 + 24);
  });

  it('sans logo : rien n’est demandé, rien n’est dessiné, la carte est moins haute', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, blob: async () => new Blob(['logo']) }));
    const withLogo = await drawn(memberCard({ photo_url: null }));
    fetchMock.mockClear();
    const without = await drawn(memberCard({ photo_url: null, logo_url: null }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(without.draws.filter((d) => d.op === 'drawImage')).toHaveLength(0);
    expect(withLogo.height - without.height).toBe(88 + 24);
  });

  it('un hôte sans CORS (le cas de `/storage-…` relevé le 2026-11-20) : la carte se dessine, sans logo', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const canvas = await drawn(memberCard({ photo_url: null }));
    expect(canvas.draws.filter((d) => d.op === 'drawImage')).toHaveLength(0);
    expect(canvas.draws.some((d) => d.op === 'fillText' && d.args[0] === 'Aminata Diop')).toBe(true);
  });

  it('la boîte du logo garde ses proportions, en largeur comme en hauteur', () => {
    expect(logoBox(400, 200)).toEqual({ w: 176, h: 88 });
    expect(logoBox(100, 300)).toEqual({ w: 59, h: 176 });
    expect(logoBox(512, 512)).toEqual({ w: 176, h: 176 });
    expect(logoBox(0, 10)).toEqual({ w: 0, h: 0 });
  });
});

/* ───────────────────────────── § 2 — S8 (§22) ───────────────────────────── */

describe('§22.8 — « Adhérer » : le sigle, le tarif et le rythme de chaque type', () => {
  const FORM: JoinForm = {
    organisation: { name: 'Association des techniciens supérieurs', logo_url: null, short_name: 'ATSARS' },
    admission_mode: 'bureau',
    categories: [
      { id: 25, label: 'Membre actif', amount_formatted: '25 000 FCFA', mode: 'forfait', period_label: 'par an' },
      { id: 26, label: 'Membre mensuel', amount_formatted: '2 000 FCFA', mode: 'forfait', period_label: 'par mois' },
    ],
    referrer: null,
    consent_text: 'J’accepte qu’ATSARS utilise ces informations.',
    ask_region: false,
    email_mode: 'hidden',
    questions: [],
  };

  it('le sigle en titre, le nom complet dessous ; chaque type avec son rythme', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, FORM));
    render(<JoinPage parrain={null} />);
    expect(await screen.findByTestId('org-sigle')).toHaveTextContent('ATSARS');
    expect(screen.getByText('Association des techniciens supérieurs')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Membre mensuel.*2 000 FCFA par mois/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Membre actif.*25 000 FCFA par an/ })).toBeInTheDocument();
  });

  it('sans sigle : le nom seul, comme avant', async () => {
    fetchMock.mockResolvedValue(fakeResponse(200, { ...FORM, organisation: { ...FORM.organisation, short_name: null } }));
    render(<JoinPage parrain={null} />);
    await screen.findByText('Association des techniciens supérieurs');
    expect(screen.queryByTestId('org-sigle')).not.toBeInTheDocument();
  });

  it('`share` à `null` : pas de bouton WhatsApp composé ici, « Ouvrir ma page » reste', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method ?? 'GET') === 'GET'
        ? fakeResponse(200, FORM)
        : fakeResponse(201, { message: 'ok', member_url: 'https://demo-asso.adhera.africa/m/<JETON>', share: null }),
    );
    render(<JoinPage parrain={null} />);
    await user.click(await screen.findByRole('radio', { name: /Membre actif/ }));
    await user.type(screen.getByLabelText(/Votre prénom/), 'Awa');
    await user.type(screen.getByLabelText(/Votre nom/), 'Gueye');
    await user.type(screen.getByLabelText(/Votre numéro WhatsApp/), '77 123 45 67');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Envoyer ma demande/ }));
    await screen.findByRole('heading', { name: 'Votre demande est envoyée' });
    expect(screen.queryByRole('link', { name: 'M’envoyer ce lien sur WhatsApp' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir ma page' })).toBeInTheDocument();
  });
});

describe('§22.5 — le rythme sur la page du membre et du candidat', () => {
  it('le bloc « à payer » : la plage de dates, puis le type et son rythme (`category_period_label`)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          due: {
            period_start: '2026-11-01',
            period_end: '2026-11-30',
            period_label: 'du 1er novembre 2026 au 30 novembre 2026',
            category_label: 'Membre mensuel',
            category_period_label: 'par mois',
            amount_due: 2000,
            amount_due_formatted: '2 000 FCFA',
            amount_paid: 0,
            amount_paid_formatted: '0 FCFA',
            balance: 2000,
            balance_formatted: '2 000 FCFA',
            status: 'due',
          },
        }),
      ),
    );
    render(<MemberPage token={TOKEN} />);
    expect(await screen.findByText('pour la période du 1er novembre 2026 au 30 novembre 2026')).toBeInTheDocument();
    expect(screen.getByTestId('due-category')).toHaveTextContent('Membre mensuel · par mois');
  });

  it('le candidat en cours d’examen : son type, son tarif et son rythme, même sans `due`', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(
        200,
        payload({
          standing: { is_up_to_date: false, covered_until: null },
          application: {
            status: 'under_review',
            submitted_at: '2026-11-04T10:15:00+00:00',
            rejection_reason: null,
            category: { label: 'Membre mensuel', amount_formatted: '2 000 FCFA', period_label: 'par mois' },
          },
        }),
      ),
    );
    render(<MemberPage token={TOKEN} />);
    expect(await screen.findByTestId('application-category')).toHaveTextContent(
      'Vous adhérez comme Membre mensuel : 2 000 FCFA par mois.',
    );
  });
});
