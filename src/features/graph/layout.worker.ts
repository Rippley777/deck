import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
cytoscape.use(fcose);
self.onmessage = (
  event: MessageEvent<{ elements: cytoscape.ElementDefinition[]; width: number; height: number }>,
) => {
  const { elements } = event.data;
  const cy = cytoscape({
    headless: true,
    elements,
    styleEnabled: true,
    layout: { name: 'preset' },
    style: [
      {
        selector: 'node',
        style: { width: 'data(size)', height: 'data(size)', label: 'data(label)', 'font-size': 11 },
      },
      { selector: '.stack', style: { width: 38, height: 38 } },
    ],
  });
  cy.layout({
    name: 'fcose',
    quality: elements.length > 700 ? 'draft' : 'default',
    animate: false,
    randomize: true,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: () => 6500,
    idealEdgeLength: () => 95,
    edgeElasticity: () => 0.25,
    gravity: 0.22,
    numIter: 2000,
    packComponents: true,
    nodeSeparation: 65,
    fit: false,
  } as cytoscape.LayoutOptions).run();
  self.postMessage(cy.nodes().map((node) => ({ id: node.id(), position: node.position() })));
  cy.destroy();
};
