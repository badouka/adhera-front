'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useBureau } from '@/components/bureau/BureauContext';
import { ChevronLeftIcon } from '@/components/bureau/Icons';
import { MemberForm } from '@/components/bureau/MemberForm';
import { PageTitle, Panel } from '@/components/bureau/ui';
import { createMember } from '@/lib/bureau/api';

/** B6 — un nouveau membre. Il arrive sur sa fiche, d'où partira son lien. */
export default function NouveauMembrePage() {
  const { settings } = useBureau();
  const router = useRouter();

  return (
    <>
      <Link href="/bureau/membres" className="small inline-flex items-center gap-1 font-semibold">
        <ChevronLeftIcon />
        Membres
      </Link>
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
