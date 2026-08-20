import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../src/components/shell/Sidebar";

describe("Sidebar", () => {
  it("renders Home, Resolution Center, and Chat nav items", () => {
    render(<Sidebar active="dashboard" onNavigate={() => {}} />);
    expect(screen.getByLabelText("Home")).toBeInTheDocument();
    expect(screen.getByLabelText("Resolution Center")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat")).toBeInTheDocument();
  });

  it("marks the active view current and calls onNavigate when Chat is clicked", () => {
    const onNavigate = vi.fn();
    render(<Sidebar active="dashboard" onNavigate={onNavigate} />);

    expect(screen.getByLabelText("Home")).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Chat")).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByLabelText("Chat"));
    expect(onNavigate).toHaveBeenCalledWith("chat");
  });
});
