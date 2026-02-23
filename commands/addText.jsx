export const config = {
  id: "addText",
  i18n: {
    en: {
      "command.addText.title": "Add Text",
      "command.addText.description": "Create an editable text node at the command trigger point",
    },
    zh: {
      "command.addText.title": "新增文字",
      "command.addText.description": "在命令触发位置创建可编辑文字节点",
    },
  },
  titleKey: "command.addText.title",
  title: "Add Text",
  descriptionKey: "command.addText.description",
  description: "Create an editable text node at the command trigger point",
  keywords: ["text", "add", "create", "文字", "新增"],
};

export const run = ({ actions }) => {
  actions.canvasActions.addTextAtViewportCenter();
};
