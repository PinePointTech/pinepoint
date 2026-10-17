import Link from "next/link";

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ total?: string }>;
}) {
  const { total } = await searchParams;
  const shownTotal = total && /^\$\d+\.\d{2}$/.test(total) ? total : null;

  return (
    <main>
      <h1>Order placed</h1>
      {shownTotal && <p>Order total: {shownTotal}</p>}
      <p className="muted">This is a demo store. No payment was taken.</p>
      <Link href="/">Back to the store</Link>
    </main>
  );
}
