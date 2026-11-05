'use client';

import { useRouter } from 'next/navigation';
import { useBackBar, useBureau } from '@/components/bureau/BureauContext';
import { MemberForm } from '@/components/bureau/MemberForm';
import { PageTitle, Panel } from '@/components/bureau/ui';
import { createMember } from '@/lib/bureau/api/members';

/** B6 — un nouveau membre. Il arrive sur sa fiche, d'où partira son lien. */
export default function NouveauMembrePage() {
  useBackBar({ href: '/bureau/membres', label: 'Les membres' });
  const { settings } = useBureau();
  const router = useRouter();

  return (
    <>
      <PageTitle title="Ajouter un membre" />
      <Panel className="max-w-[720px]">
        <MemberForm
          memberTypes={settings.member_types}
          submitLabel="Ajouter le membre"
          onCancel={() => router.push('/bureau/membres')}
          onSubmit={async (input) => {
            const member = await createMember(input);
            router.replace(`/bureau/membres/${encodeURIComponent(member.id)}?cree=1`);
          }}
        />
      </Panel>
    </>
  );
}
