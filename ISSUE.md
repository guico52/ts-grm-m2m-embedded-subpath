# [BUG] - DTO construction crashes with `TypeError: Cannot read properties of undefined (reading 'toFields')` when an `m2m` collection sub-view accesses an embedded sub-path

> Suggested label: `bug`.

---

### ts-grm Version

`@ts-grm/core` 0.0.12 / `@ts-grm/sql` 0.0.12 (npm latest) — also reproduced on local `main`
(HEAD `c7bbc06`, verified 2026-09-07)

### Node Version

Node v24.15.0 (any Node >= 20, ESM)

### Database

N/A (the crash happens during DTO construction in the query execution phase, before DML is issued; reproduced with a fake pool)

### OS

Linux

### Expected behavior

With an `m2m` collection association where the target's property is an `embedded` struct that contains sub-paths, a collection sub-view selecting a sub-path should work:

```ts
const BookView = dto.view(Book, c => [
    c.$allScalars,
    c.authors.with(a => [a.id, a.name.lastName]), // embedded sub-path
]);
```

The query should return books with the authors' `lastName`.

### Actual behavior

The query throws at DTO construction time:

```
TypeError: Cannot read properties of undefined (reading 'toFields')
```

Selecting the **whole** embedded (`c.authors.with(a => [a.id, a.name])`) or plain scalars
(`c.authors.with(a => [a.id])`) works fine — the defect is specific to an embedded **sub-path**
inside an `m2m` collection sub-view.

### Description

**Scenario**: `Book.authors = prop.m2m(Author)` with a `book_author_mapping` join table;
`Author.name = prop.embedded({ firstName, lastName })`.

**Suspected root cause** (from source review of `main`): in
`packages/core/src/impl/dto_context.ts`, `DtoFactory.addMapping` calls
`mapping.toFields(this._downcastTo)`; for the collection-element mapping produced by an
embedded sub-path access inside an `m2m` collection sub-view, `mapping` resolves to
`undefined`, hence `Cannot read properties of undefined (reading 'toFields')`.

**Control experiments** (both pass, proving the framework is fine and the defect is specific to
embedded sub-path inside `m2m` collection sub-views):

- `c.authors.with(a => [a.id, a.name])` — whole embedded — runs fine;
- `c.authors.with(a => [a.id])` — scalars only — runs fine.

Also note: the same embedded sub-path works in other positions (this is the standard documented
way to project embedded fields; e.g. it works for `o2m`/`m2o` sub-views and plain entity fetches),
so the crash is specific to the `m2m` collection sub-view path.

### Reproduction steps

```bash
git clone / npx …  # any project using @ts-grm/core@0.0.12
npm install @ts-grm/core@0.0.12 @ts-grm/sql@0.0.12
node repro above
```

Minimal reproduction (defect + two control tests in `repro.test.mjs` of this repo):

```ts
import { model, prop, dto } from "@ts-grm/core";

const Author = model("Author", "id", class {
    id = prop.i64()
    name = prop.embedded({ firstName: prop.str(50), lastName: prop.str(50) })
    books = prop.m2m(Book).mappedBy("authors")
});

const Book = model("Book", "id", class {
    id = prop.i64()
    name = prop.str(50)
    edition = prop.i32()
    price = prop.num(10, 2)
    authors = prop.m2m(Author).joinTable({
        name: "book_author_mapping",
        joinThisColumns: ["book_id"],
        joinTargetColumns: ["author_id"],
    })
});

const BookView = dto.view(Book, c => [
    c.$allScalars,
    c.authors.with(a => [a.id, a.name.lastName]), // <-- embedded sub-path
]);

await client.createQuery(Book, (q, book) => q.select(book.fetch(BookView))).fetchList();
// TypeError: Cannot read properties of undefined (reading 'toFields')
```