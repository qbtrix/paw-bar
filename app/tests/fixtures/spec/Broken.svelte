<!-- Test stand-in: throws while rendering. Created 2026-09-27 for the spec renderer tests. -->
<script lang="ts">
  function fail(): string {
    throw new Error('broken on purpose');
  }
</script>

<p>{fail()}</p>
