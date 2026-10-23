Page({ data: { from: '' }, onLoad(query) { this.setData({ from: query.from || '直接打开' }); console.info('详情页参数', query); }, back() { wx.navigateBack(); } });
