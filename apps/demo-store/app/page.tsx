import { Store } from "@/components/store";

export default function Home() {
  return (
    <main>
      <h1>Linen and Oat</h1>
      <p className="muted">
        Kitchen linens. Free shipping from $20.00. Use BUNDLE15 to get 15% off
        3 or more items.
      </p>
      <Store />
    </main>
  );
}
