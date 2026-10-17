import { findProduct } from "./products";

export type CartLine = { productId: string; quantity: number };
export type Cart = { lines: CartLine[]; coupons: string[] };

export const emptyCart: Cart = { lines: [], coupons: [] };

export const SHIPPING_CENTS = 400;
export const FREE_SHIPPING_FROM_CENTS = 2000;

// Percent off the subtotal, per code.
const PERCENT_COUPONS: Record<string, number> = { SAVE10: 10 };

export function addItem(cart: Cart, productId: string): Cart {
  const line = cart.lines.find((l) => l.productId === productId);
  const lines = line
    ? cart.lines.map((l) =>
        l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l,
      )
    : [...cart.lines, { productId, quantity: 1 }];
  return { ...cart, lines };
}

export function removeItem(cart: Cart, productId: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.productId !== productId) };
}

export function applyCoupon(
  cart: Cart,
  input: string,
): { cart: Cart; message: string } {
  const code = input.trim().toUpperCase();
  if (!(code in PERCENT_COUPONS)) {
    return { cart, message: "Coupon not valid." };
  }
  if (cart.coupons.includes(code)) {
    return { cart, message: "Coupon already applied." };
  }
  return {
    cart: { ...cart, coupons: [...cart.coupons, code] },
    message: `${code} applied.`,
  };
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
};

export function totals(cart: Cart): Totals {
  const subtotalCents = cart.lines.reduce(
    (sum, line) =>
      sum + (findProduct(line.productId)?.priceCents ?? 0) * line.quantity,
    0,
  );

  let discountedCents = subtotalCents;
  for (const code of cart.coupons) {
    const percent = PERCENT_COUPONS[code];
    if (percent) {
      discountedCents = Math.round((discountedCents * (100 - percent)) / 100);
    }
  }

  const shippingCents =
    subtotalCents === 0 || subtotalCents >= FREE_SHIPPING_FROM_CENTS
      ? 0
      : SHIPPING_CENTS;

  return {
    subtotalCents,
    discountCents: subtotalCents - discountedCents,
    shippingCents,
    totalCents: discountedCents + shippingCents,
  };
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
