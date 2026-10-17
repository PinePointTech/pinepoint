export type Product = {
  id: string;
  name: string;
  priceCents: number;
  description: string;
};

export const products: Product[] = [
  {
    id: "sage-linen-apron",
    name: "Sage linen apron",
    priceCents: 2400,
    description: "Washed linen apron with two front pockets.",
  },
  {
    id: "oat-oven-glove",
    name: "Oat oven glove",
    priceCents: 900,
    description: "Quilted cotton glove for hot trays.",
  },
  {
    id: "linen-tea-towel-set",
    name: "Linen tea towel set",
    priceCents: 1600,
    description: "Set of three striped tea towels.",
  },
];

export function findProduct(id: string): Product | undefined {
  return products.find((product) => product.id === id);
}
