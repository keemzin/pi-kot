import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFavoriteStore } from "./favorite-store";
import * as apiClient from "../lib/api-client";

vi.mock("../lib/api-client", () => ({
  updateUiSettings: vi.fn().mockResolvedValue({}),
}));

const mockStorage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const k of Object.keys(mockStorage)) {
      delete mockStorage[k];
    }
  },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("favorite-store", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useFavoriteStore.setState({
      favorites: [],
      favoriteSet: new Set(),
    });
    vi.clearAllMocks();
  });

  it("checks favorite status with O(1) isFavorite", () => {
    expect(useFavoriteStore.getState().isFavorite("session-1")).toBe(false);

    useFavoriteStore.getState().setFavorites(["session-1", "session-2"]);
    expect(useFavoriteStore.getState().isFavorite("session-1")).toBe(true);
    expect(useFavoriteStore.getState().isFavorite("session-2")).toBe(true);
    expect(useFavoriteStore.getState().isFavorite("session-3")).toBe(false);
  });

  it("toggles favorite state on and off", () => {
    useFavoriteStore.getState().toggle("session-1");
    expect(useFavoriteStore.getState().favorites).toEqual(["session-1"]);
    expect(useFavoriteStore.getState().isFavorite("session-1")).toBe(true);
    expect(apiClient.updateUiSettings).toHaveBeenCalledWith({
      favoriteSessions: ["session-1"],
    });

    useFavoriteStore.getState().toggle("session-1");
    expect(useFavoriteStore.getState().favorites).toEqual([]);
    expect(useFavoriteStore.getState().isFavorite("session-1")).toBe(false);
    expect(apiClient.updateUiSettings).toHaveBeenCalledWith({
      favoriteSessions: [],
    });
  });

  it("unfavorites session if present and ignores if not", () => {
    useFavoriteStore.getState().setFavorites(["session-1", "session-2"]);
    vi.clearAllMocks();

    useFavoriteStore.getState().unfavorite("session-1");
    expect(useFavoriteStore.getState().favorites).toEqual(["session-2"]);
    expect(useFavoriteStore.getState().isFavorite("session-1")).toBe(false);
    expect(apiClient.updateUiSettings).toHaveBeenCalledWith({
      favoriteSessions: ["session-2"],
    });

    // Unfavoriting non-existent id should not re-trigger sync
    vi.clearAllMocks();
    useFavoriteStore.getState().unfavorite("non-existent");
    expect(apiClient.updateUiSettings).not.toHaveBeenCalled();
  });

  it("prunes invalid or deleted session IDs", () => {
    useFavoriteStore.getState().setFavorites(["s1", "s2", "s3", "s4"]);
    vi.clearAllMocks();

    useFavoriteStore.getState().prune(["s2", "s4", "s5"]);
    expect(useFavoriteStore.getState().favorites).toEqual(["s2", "s4"]);
    expect(useFavoriteStore.getState().isFavorite("s1")).toBe(false);
    expect(useFavoriteStore.getState().isFavorite("s2")).toBe(true);
    expect(apiClient.updateUiSettings).toHaveBeenCalledWith({
      favoriteSessions: ["s2", "s4"],
    });

    // Pruning when all valid is a no-op
    vi.clearAllMocks();
    useFavoriteStore.getState().prune(["s2", "s4"]);
    expect(apiClient.updateUiSettings).not.toHaveBeenCalled();
  });

  it("deduplicates IDs in setFavorites", () => {
    useFavoriteStore.getState().setFavorites(["a", "b", "a", "c"]);
    expect(useFavoriteStore.getState().favorites).toEqual(["a", "b", "c"]);
    expect(useFavoriteStore.getState().isFavorite("a")).toBe(true);
    expect(useFavoriteStore.getState().isFavorite("b")).toBe(true);
    expect(useFavoriteStore.getState().isFavorite("c")).toBe(true);
  });
});
