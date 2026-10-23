Page({
  data: { draft: '', tasks: [{ id: 1, title: '验证 WXML 数据绑定' }], count: 0, features: ['rpx', 'tabBar', 'setData', 'Component'] },
  onLoad() { console.info('实验室页面已加载'); },
  onInput(event) { this.setData({ draft: event.detail.value }); },
  addTask() {
    const title = this.data.draft.trim();
    if (!title) return wx.showToast({ title: '先输入任务名称', icon: 'none' });
    this.setData({ tasks: this.data.tasks.concat({ id: Date.now(), title }), draft: '' });
    console.info('任务已添加', title);
  },
  onCountChange(event) { this.setData({ count: event.detail.value }); console.info('组件计数', event.detail.value); },
  openDetail() { wx.navigateTo({ url: '/pages/detail/detail?from=lab' }); },
  showToast() { wx.showToast({ title: '基础交互正常', icon: 'success' }); }
});
