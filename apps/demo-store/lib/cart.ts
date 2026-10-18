import { findProduct } from "./products";

export type CartLine = { productId: string; quantity: number };
export type Cart = { lines: CartLine[]; coupons: string[] };

export const emptyCart: Cart = { lines: [], coupons: [] };

export const SHIPPING_CENTS = 400;
export const FREE_SHIPPING_FROM_CENTS = 2000;

// Percent off the subtotal, per code. Only one code per order.
type PercentCoupon = { percent: number; minItems: number };

const PERCENT_COUPONS: Record<string, PercentCoupon> = {
  SAVE10: { percent: 10, minItems: 0 },
  BUNDLE15: { percent: 15, minItems: 3 },
};

export function itemCount(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}

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
  const coupon = PERCENT_COUPONS[code];
  if (!coupon) {
    return { cart, message: "Coupon not valid." };
  }
  const appliedCode = cart.coupons.find((c) => c === code);
  if (appliedCode) {
    return {
      cart,
      message:
        appliedCode === code
          ? "Coupon already applied."
          : "Only one discount code per order.",
    };
  }
  if (itemCount(cart) < coupon.minItems) {
    return { cart, message: `${code} needs ${coupon.minItems} or more items.` };
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

  const count = itemCount(cart);
  let discountedCents = subtotalCents;
  for (const code of cart.coupons) {
    const coupon = PERCENT_COUPONS[code];
    if (coupon && count >= coupon.minItems) {
      discountedCents = Math.round(
        (discountedCents * (100 - coupon.percent)) / 100,
      );
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
