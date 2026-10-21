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

// The cart is saved in this browser, so that it stays after a page reload.
export const CART_STORAGE_KEY = "linen-and-oat-cart";
const MAX_SAVED_QUANTITY = 999;

// Read the saved cart. No saved cart or bad data gives an empty cart.
export function loadSavedCart(): Cart {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return emptyCart;
    const data = JSON.parse(raw) as Partial<Cart>;
    const saved: Cart = {
      lines: Array.isArray(data.lines) ? data.lines : [],
      coupons: Array.isArray(data.coupons) ? data.coupons : [],
    };

    // Build the cart again with the same steps that a shopper uses, so
    // that it can only hold products, quantities and coupons we know.
    let cart = saved;
    for (const line of saved.lines) {
      if (!findProduct(line.productId)) continue;
      const quantity = Math.min(
        Math.trunc(Number(line.quantity)) || 0,
        MAX_SAVED_QUANTITY,
      );
      for (let i = 0; i < quantity; i++) cart = addItem(cart, line.productId);
    }
    for (const code of saved.coupons) {
      cart = applyCoupon(cart, String(code)).cart;
    }
    return cart;
  } catch {
    return emptyCart;
  }
}

export function saveCart(cart: Cart): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage can be full or blocked. The cart still works until a reload.
  }
}

export function clearSavedCart(): void {
  try {
    window.localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    // Nothing to do. See saveCart.
  }
}
