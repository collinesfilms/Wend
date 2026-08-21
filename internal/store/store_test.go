package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func open(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	ctx := context.Background()
	if err := st.EnsureDomains(ctx, []string{"go.collines.co", "clns.li"}); err != nil {
		t.Fatalf("domains: %v", err)
	}
	if err := st.UpsertUser(ctx, User{ID: "sub-1", Email: "a@collines.co", Name: "A"}); err != nil {
		t.Fatalf("user: %v", err)
	}
	return st
}

func TestNormalizeSlug(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr error
	}{
		{"Lab-3", "lab-3", nil},           // lookups are case-insensitive
		{" /tp-3/ ", "tp-3", nil},         // stray slashes and spaces forgiven
		{"x7kq2", "x7kq2", nil},
		{"api", "", ErrSlugReserved},      // never shadow the server's own paths
		{"sw.js", "", ErrSlugReserved},
		{"", "", ErrSlugInvalid},
		{"-nope", "", ErrSlugInvalid},     // must start alphanumeric
		{"a b", "", ErrSlugInvalid},
	}
	for _, c := range cases {
		got, err := NormalizeSlug(c.in)
		if c.wantErr != nil {
			if !errors.Is(err, c.wantErr) {
				t.Errorf("NormalizeSlug(%q) error = %v, want %v", c.in, err, c.wantErr)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("NormalizeSlug(%q) = %q, %v; want %q", c.in, got, err, c.want)
		}
	}
}

func TestCreateAndResolve(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	d, _ := st.DomainByHost(ctx, "go.collines.co")

	link, err := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/tp", Slug: "TP-3", DomainID: d.ID, OwnerID: "sub-1",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if link.Slug != "tp-3" {
		t.Fatalf("slug = %q, want lowercase tp-3", link.Slug)
	}

	// A slug typed with capitals, or with a port on the host, still resolves.
	for _, probe := range []struct{ host, slug string }{
		{"go.collines.co", "tp-3"},
		{"go.collines.co", "TP-3"},
		{"go.collines.co:8080", "Tp-3"},
	} {
		got, err := st.Resolve(ctx, probe.host, probe.slug)
		if err != nil {
			t.Fatalf("resolve %v: %v", probe, err)
		}
		if got.Dest != "https://collines.co/tp" {
			t.Fatalf("resolve %v gave %q", probe, got.Dest)
		}
	}

	// The same slug on a different domain is a different link.
	if _, err := st.Resolve(ctx, "clns.li", "tp-3"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("clns.li/tp-3 should not resolve, got %v", err)
	}
}

func TestSlugIsNeverRecycled(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	d, _ := st.DomainByHost(ctx, "go.collines.co")

	link, err := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/one", Slug: "lab", DomainID: d.ID, OwnerID: "sub-1",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.Delete(ctx, link.ID, "sub-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// Deleting frees nothing: a slug already handed out must never point
	// somewhere new, or last term's link sends students to a surprise.
	if _, err := st.Create(ctx, CreateLink{
		Dest: "https://example.com/other", Slug: "lab", DomainID: d.ID, OwnerID: "sub-1",
	}); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("recreating a deleted slug gave %v, want ErrSlugTaken", err)
	}
	if _, err := st.Resolve(ctx, "go.collines.co", "lab"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted slug still resolves: %v", err)
	}
	available, err := st.SlugAvailable(ctx, d.ID, "lab")
	if err != nil || available {
		t.Fatalf("SlugAvailable after delete = %v, %v; want false", available, err)
	}
}

func TestAliasesShareTheNamespace(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	d, _ := st.DomainByHost(ctx, "go.collines.co")

	link, _ := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/x", Slug: "first", DomainID: d.ID, OwnerID: "sub-1",
	})
	if err := st.AddAlias(ctx, link.ID, d.ID, "second"); err != nil {
		t.Fatalf("alias: %v", err)
	}
	got, err := st.Resolve(ctx, "go.collines.co", "second")
	if err != nil || got.LinkID != link.ID {
		t.Fatalf("alias did not resolve to the same link: %v %v", got, err)
	}
	// An alias occupies the namespace like any other slug.
	if _, err := st.Create(ctx, CreateLink{
		Dest: "https://example.com", Slug: "second", DomainID: d.ID, OwnerID: "sub-1",
	}); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("alias slug was reusable: %v", err)
	}
	// Both slugs reach the same counters.
	full, _ := st.Link(ctx, link.ID)
	if len(full.Aliases) != 1 || full.Aliases[0].Slug != "second" {
		t.Fatalf("aliases = %+v", full.Aliases)
	}
}

func TestClicksAreCountedAndDeduplicated(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	d, _ := st.DomainByHost(ctx, "go.collines.co")
	link, _ := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/x", Slug: "count", DomainID: d.ID, OwnerID: "sub-1",
	})

	for i := 0; i < 3; i++ {
		if err := st.RecordClick(ctx, link.ID, "visitor-a"); err != nil {
			t.Fatalf("click: %v", err)
		}
	}
	if err := st.RecordClick(ctx, link.ID, "visitor-b"); err != nil {
		t.Fatalf("click: %v", err)
	}

	got, _ := st.Link(ctx, link.ID)
	if got.Clicks != 4 {
		t.Errorf("clicks = %d, want 4", got.Clicks)
	}
	if got.Uniques != 2 {
		t.Errorf("uniques = %d, want 2", got.Uniques)
	}
	if len(got.Series) != 7 {
		t.Fatalf("series length = %d, want 7", len(got.Series))
	}
	if got.Series[6] != 4 {
		t.Errorf("today's bucket = %d, want 4", got.Series[6])
	}
}

func TestExpiryAndRevival(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	d, _ := st.DomainByHost(ctx, "go.collines.co")
	past := time.Now().UTC().Add(-time.Hour)
	link, _ := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/x", Slug: "gone", DomainID: d.ID, OwnerID: "sub-1", ExpiresAt: &past,
	})

	got, _ := st.Link(ctx, link.ID)
	if !got.Expired {
		t.Fatal("link should read as expired")
	}
	// An expired link is still resolvable data: reviving it must not need a
	// new slug, because the old one is already in people's hands.
	future := time.Now().UTC().Add(48 * time.Hour)
	f := &future
	if err := st.Update(ctx, link.ID, "sub-1", UpdateLink{ExpiresAt: &f}); err != nil {
		t.Fatalf("revive: %v", err)
	}
	got, _ = st.Link(ctx, link.ID)
	if got.Expired {
		t.Fatal("revived link still reads as expired")
	}
	if got.Slug != "gone" {
		t.Fatalf("slug changed on revival: %q", got.Slug)
	}
}

func TestOwnershipIsEnforced(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	_ = st.UpsertUser(ctx, User{ID: "sub-2"})
	d, _ := st.DomainByHost(ctx, "go.collines.co")
	link, _ := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/x", Slug: "mine", DomainID: d.ID, OwnerID: "sub-1",
	})

	dest := "https://evil.example"
	if err := st.Update(ctx, link.ID, "sub-2", UpdateLink{Dest: &dest}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user could edit the link: %v", err)
	}
	if err := st.Delete(ctx, link.ID, "sub-2"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another user could delete the link: %v", err)
	}
	list, _ := st.List(ctx, "sub-2")
	if len(list) != 0 {
		t.Fatalf("another user sees %d links", len(list))
	}
}

func TestDomainWithLinksCannotBeRemoved(t *testing.T) {
	st := open(t)
	ctx := context.Background()
	d, _ := st.DomainByHost(ctx, "clns.li")
	if _, err := st.Create(ctx, CreateLink{
		Dest: "https://collines.co/x", Slug: "keep", DomainID: d.ID, OwnerID: "sub-1",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.DeleteDomain(ctx, d.ID); err == nil {
		t.Fatal("removing a domain that still serves links should fail")
	}
}
