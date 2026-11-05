import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignedPhoto } from '@/components/SignedPhoto';

describe('§21.3 — un lien de photo périmé', () => {
  it('ne laisse pas une image cassée : il dit de recharger la page', () => {
    render(<SignedPhoto src="https://api.eventflow.africa/p?expires=1" alt="Photo de Awa" size={96} className="" testId="my-photo" />);
    fireEvent.error(screen.getByTestId('my-photo'));
    expect(screen.queryByTestId('my-photo')).toBeNull();
    expect(screen.getByTestId('my-photo-expired').textContent).toBe('Photo indisponible : rechargez la page.');
  });

  it('un nouveau lien (page relue) se réaffiche', () => {
    const { rerender } = render(<SignedPhoto src="https://a/1" alt="x" size={96} className="" testId="p" />);
    fireEvent.error(screen.getByTestId('p'));
    rerender(<SignedPhoto src="https://a/2" alt="x" size={96} className="" testId="p" />);
    expect(screen.getByTestId('p').getAttribute('src')).toBe('https://a/2');
  });
});
