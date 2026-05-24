import CreatePageClient from "./_components/CreatePageClient";

export default function CreatePage() {
  return <CreatePageClient currentYear={new Date().getFullYear()} />;
}
