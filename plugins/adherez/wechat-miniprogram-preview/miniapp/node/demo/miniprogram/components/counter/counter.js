Component({
  properties: { label: { type: String, value: '计数器' } },
  data: { value: 0 },
  methods: { increment() { const value = this.data.value + 1; this.setData({ value }); this.triggerEvent('change', { value }); } }
});
